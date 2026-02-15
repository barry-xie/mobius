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

## Re-ingesting after moving Snowflake

When you point the app at a **new Snowflake instance** (new account, clone, or different DB), re-ingest and re-encode all course data as follows. The first run will create the RAG schema and tables in the new instance; then you re-run the lesson-plan and tagging pipeline for each course you care about.

**1. Update `.env` with the new Snowflake credentials**

In the repo root `.env`, set at least:

- `SNOWFLAKE_HOST` – e.g. `abc12345.us-east-1.aws.snowflakecomputing.com`
- `SNOWFLAKE_TOKEN` – your Snowflake API token (e.g. programmatic access token)
- `SNOWFLAKE_WAREHOUSE` – warehouse name
- `SNOWFLAKE_ROLE` – role name (if required by your instance)
- `SNOWFLAKE_DATABASE` – database name (default `KNOT` if unset)
- `SNOWFLAKE_TOKEN_TYPE` – e.g. `PROGRAMMATIC_ACCESS_TOKEN` (default)

Keep `CANVAS_API` and `GEMINI_API_KEY` set so ingestion and embeddings can run.

**2. Ingest all courses (documents + chunking + embeddings)**

From the **ingestion** directory:

```bash
cd ingestion
pip install -r requirements.txt   # if needed
python ingest_course.py
```

This will:

- Create the database and `RAG` schema and tables in the new Snowflake instance if they don’t exist.
- Fetch all courses from Canvas (using `CANVAS_API`), then for each course: fetch modules, assignments, files, pages, syllabus; extract text; chunk; embed with Gemini; insert into `KNOT.RAG.documents` and `KNOT.RAG.document_chunks`.

To ingest only one course:

```bash
python ingest_course.py --course-id <Canvas_course_id>
```

**3. Build lesson plan and tag chunks (per course)**

For each course that should have learning structure (units/topics/subtopics) and tagged chunks, run, in order:

```bash
python build_lesson_plan.py --course-id <ID> --course-name "Course Display Name"
python tag_chunks.py --course-id <ID> [--batch-size 10]
```

Optionally, run the full concept pipeline (build plan + tag + merge into `public/classNames.json`):

```bash
python run_concept_generation.py --course-id <ID> --course-name "Course Display Name"
```

**4. Verify**

- Row counts: `python check_rag_counts.py` (if available) to confirm tables are populated.
- Conceptual units: `python list_units.py --course-id <ID> --conceptual`
- Frontend: open the app, go through onboarding or dashboard, and confirm classes and concepts load from the new instance.

**Summary order**

| Step | Command | What it does |
|------|--------|---------------|
| 1 | Update `.env` | Point at new Snowflake (host, token, warehouse, role, database). |
| 2 | `python ingest_course.py` | Create RAG schema/tables; ingest all courses and encode chunks. |
| 3 | Per course | `build_lesson_plan.py` → `tag_chunks.py` (and optionally `run_concept_generation.py`). |

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

**Stored JSON (multi-course):** All concept/learning-structure output is merged into **`public/classNames.json`** so the frontend has one file at the **course** level. Schema:

- **`classes`**: array of `{ className, courseId, units }` — one entry per course; `units` is the full learning structure (unit → topic → subtopic with chunk counts).
- **`classNames`**: array of course display names (for backward compatibility with onboarding/dashboard).
- **`updatedAt`**: ISO timestamp.

Running concept generation for one course (Python or API) **merges** that course into `classNames.json`; running for multiple courses (API with `courseIds`) updates or appends each. Existing entries are matched by `courseId` or `className`.

**How to test**

1. **Python (one course → classNames.json)**  
   From `ingestion` with venv active and a course already ingested + lesson plan built (or run full pipeline once):
   ```bash
   cd ingestion
   .\.venv\Scripts\Activate
   python run_concept_generation.py --course-id 45110000000215700 --course-name "Computer Org"
   ```
   - Check **`public/classNames.json`**: should have `classes` with one entry `{ "className": "...", "courseId": "45110000000215700", "units": [ ... ] }` and `classNames` with that name. If the file had other courses (e.g. placeholder `concepts`), they stay; this course is added or updated.

2. **API (Node server)**  
   From repo root:
   ```bash
   node server.js
   ```
   Then in another terminal or browser:
   - **Single course:** `curl "http://localhost:8080/api/canvas/concepts?courseId=45110000000215700"`  
   - **Multiple:** `curl -X POST http://localhost:8080/api/canvas/concepts -H "Content-Type: application/json" -d "{\"courseIds\":[\"45110000000215700\"]}"`  
   Check **`public/classNames.json`** again: the course(s) should be merged (same schema as above).

3. **Multi-course merge**  
   Run concept generation (or call the API) for a second course that has RAG data. Open **`public/classNames.json`**: `classes` should have two entries (each with `className`, `courseId`, `units`) and `classNames` should list both names.

4. **Frontend**  
   Load the app and open the onboarding or dashboard page that reads `classNames.json` (or `/api/canvas/concepts`). Confirm the list of classes and, if your UI shows it, the units/topics/subtopics for a selected course.

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
