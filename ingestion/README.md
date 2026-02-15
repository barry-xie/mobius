# Knot RAG Ingestion

Python ingestion for the Knot RAG pipeline: **Canvas API → download files / extract HTML text → chunk → Gemini embed → Snowflake RAG schema**.

- **Separate schema**: All RAG tables live in schema `RAG` (e.g. `KNOT.RAG.courses`, `KNOT.RAG.documents`, `KNOT.RAG.document_chunks`), not in the existing Canvas schema.
- **HTML content**: Syllabus, assignment descriptions, and Canvas pages are fetched and converted to plain text (BeautifulSoup).
- **File downloads**: Canvas file URLs are downloaded with your API token; PDFs are extracted with pypdf (other types can be added later).

## Setup

From repo root (where `.env` lives):

```bash
cd ingestion
pip install -r requirements.txt
```

Ensure `.env` in the repo root has `CANVAS_API`, `GEMINI_API_KEY`, and Snowflake vars (`SNOWFLAKE_HOST`, `SNOWFLAKE_TOKEN`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_DATABASE`, etc.).

## Run

From the **ingestion** directory (so imports resolve):

```bash
cd ingestion
python ingest_course.py
```

To ingest a single course:

```bash
python ingest_course.py --course-id 12345
```

The script will:

1. Create database/schema and RAG tables if missing (`KNOT.RAG.courses`, `.modules`, `.documents`, `.document_chunks`).
2. Fetch courses (and optionally filter by `--course-id`).
3. For each course: fetch modules, assignments, files, pages, syllabus; extract text from HTML and downloaded files; insert/merge into `documents`; chunk (800–1200 chars, 150 overlap); embed with Gemini; insert into `document_chunks`.

Re-running is idempotent for courses, modules, and documents (MERGE). Chunks for a document are deleted before re-inserting when that document is re-ingested.

### Human-readable source (traceability)

Each row in `document_chunks` includes:
- **document_title** – e.g. "Syllabus: Intro Computer Organization I", "Lecture 5 slides.pdf"
- **course_name** – e.g. "Intro Computer Organization I"
- **module_name** – e.g. "Week 3: Binary Arithmetic" (from Canvas modules)

So you can trace any chunk to a readable course → module → document without joining tables. Existing chunk rows get these columns via `ALTER TABLE` on next run; re-run ingest to backfill the new fields for existing data.

---

## Lesson plan and chunk tagging (unit / topic / subtopic)

After ingestion you can build a **conceptual lesson plan** and tag chunks so retrieval can be scoped by unit, topic, or subtopic.

**Order of operations:**

1. **Ingest** (above): `python ingest_course.py --course-id ID`
2. **Build lesson plan**: `python build_lesson_plan.py --course-id ID --course-name "Course Name"`  
   - Uses syllabus first; if missing or short, uses sampled chunk content. Writes to `KNOT.RAG.units`, `.topics`, `.subtopics`.
3. **Tag chunks**: `python tag_chunks.py --course-id ID [--batch-size 10]`  
   - Batched LLM assigns each chunk to one or more (unit, topic, subtopic). Writes to `KNOT.RAG.chunk_assignments`. Re-running replaces assignments for that course.

**List conceptual units (with chunk counts):**

```bash
python list_units.py --course-id ID --conceptual
```

Use the printed `unit_id`, `topic_id`, `subtopic_id` values with `generate_questions.py` (see below).

**HTTP API (for frontend):** The Node server (`server.js`) and the Next.js route `app/api/canvas/concepts/route.ts` expose conceptual units so the UI can read the real lesson plan instead of placeholders.

- **GET** `/api/canvas/concepts?courseId=<Canvas course ID>` → `{ units: [...] }`
- **POST** `/api/canvas/concepts` with `{ courseId: "..." }` or `{ courseIds: ["...", "..."] }` → `{ units }` (single) or `{ courses: [{ courseId, units }] }` (multiple)

Each unit has `unit_id`, `unit_name`, `chunk_count`, and `topics`; each topic has `topic_id`, `topic_name`, `chunk_count`, and `subtopics`; each subtopic has `subtopic_id`, `subtopic_name`, `chunk_count`. Use **Canvas course ID** (e.g. from your Canvas course list), not course name. The API returns **`courseName`** (from the RAG `courses` table) for human-readable display instead of showing the raw course ID.

**Stored JSON:** Whenever the concepts API is called, the response is also written to **`public/concepts.json`** so the frontend can load it directly (e.g. `fetch('/concepts.json')` or `fetch('/public/concepts.json')` depending on your server). The file includes `courseId`, **`courseName`** (human-readable), `units` (or `courses` with `courseName` per course), and `updatedAt` (ISO timestamp).

---

## Generate practice questions (RAG)

After ingestion, generate questions from course material:

```bash
python generate_questions.py --course-id 45110000000215700 --query "binary arithmetic" --num-questions 5
```

- **Retrieve**: Embeds the query, runs cosine similarity in Snowflake (course-scoped, top 8 chunks, threshold 0.25). If fewer than 2 chunks pass, returns the failure message.
- **Generate**: Sends the retrieved chunk text (and chunk_id, document_title, course_name, module_name) to Gemini 2.0 Flash with instructions to use only that material and cite chunk_ids.
- **Output**: JSON with `questions` (each has `question`, `answer`, `type`, `source_chunk_ids`, and **source_display** – human-readable "Course | Module | Document" for each source).

**Scoped generation (unit / topic / subtopic):**  
If you’ve built a lesson plan and run `tag_chunks.py`, you can limit retrieval to a unit, topic, or subtopic:

```bash
python generate_questions.py --course-id ID --query "binary arithmetic" --unit-id u1
python generate_questions.py --course-id ID --query "ALU design" --unit-id u1 --topic-id t1
python generate_questions.py --course-id ID --query "carry lookahead" --unit-id u1 --topic-id t1 --subtopic-id s1
```

IDs come from `list_units.py --conceptual`.
