"""
Knot RAG generation: embed query -> retrieve top-k chunks from Snowflake -> Gemini generates
practice questions from ONLY that material, with citations. Optionally scope by unit/topic/subtopic.
Usage:
  python generate_questions.py --course-id 45110000000215700 --query "binary arithmetic" --num-questions 5
  python generate_questions.py --course-id ID --query "..." --unit-id u1 --topic-id t1
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

from google import genai
from google.genai import types

from config import (
    FAILURE_MESSAGE,
    GEMINI_API_KEY,
    GEMINI_GENERATION_MODEL,
    RETRIEVAL_MIN_CHUNKS,
    RETRIEVAL_THRESHOLD,
    RETRIEVAL_TOP_K,
)
from embedding import embed_text
from snowflake_rag import retrieve_chunks

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY required")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _build_rag_prompt(chunks: list[dict[str, Any]], query: str, num_questions: int) -> str:
    """Build prompt that injects retrieved chunks so Gemini uses only that material."""
    material_lines = []
    for i, c in enumerate(chunks, 1):
        chunk_id = c.get("chunk_id") or ""
        doc_title = c.get("document_title") or "Unknown document"
        course_name = c.get("course_name") or ""
        module_name = c.get("module_name") or ""
        text = (c.get("text") or "").strip()
        material_lines.append(
            f"[Source {i}] (chunk_id: {chunk_id})\n"
            f"  Course: {course_name} | Module: {module_name} | Document: {doc_title}\n"
            f"  Content:\n{text}\n"
        )
    material_block = "\n".join(material_lines)
    return f"""You are a practice question generator for a course. Use ONLY the following course material to generate {num_questions} practice questions. Do not use external knowledge.

Topic/query from the user: {query}

Course material (each has a chunk_id for citation):
{material_block}

Instructions:
- Generate exactly {num_questions} questions that test understanding of the material above.
- Use a mix of short-answer and multiple-choice questions where appropriate.
- Each question must be answerable from the material above only.
- For each question, you MUST cite one or more chunk_ids from the list above (e.g. source_chunk_ids: ["<chunk_id>"]).
- Format your response as a JSON object with a single key "questions" whose value is an array of objects. Each object must have:
  - "question": string (the question text)
  - "answer": string (the correct answer)
  - "type": "short_answer" or "multiple_choice"
  - "source_chunk_ids": array of strings (chunk_ids from the material above that support this question)
  - If type is "multiple_choice", also include "options": array of strings (all choices) and "correct_index": integer (0-based index of the correct option in "options")

Return only valid JSON, no markdown or extra text."""


def _parse_questions_json(text: str) -> list[dict[str, Any]]:
    """Extract JSON from model output (may be wrapped in markdown)."""
    text = (text or "").strip()
    # Remove markdown code block if present
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    try:
        data = json.loads(text)
        return data.get("questions") if isinstance(data, dict) else []
    except json.JSONDecodeError:
        return []


def _validate_citations(questions: list[dict], valid_chunk_ids: set[str]) -> list[dict]:
    """Ensure each question's source_chunk_ids are in the retrieved set; filter invalid."""
    valid_chunk_ids = valid_chunk_ids or set()
    out = []
    for q in questions:
        cited = q.get("source_chunk_ids") or []
        valid_cited = [c for c in cited if c in valid_chunk_ids]
        if not valid_cited and cited:
            valid_cited = [cited[0]] if cited[0] in valid_chunk_ids else []
        q["source_chunk_ids"] = valid_cited
        out.append(q)
    return out


def _add_readable_sources(questions: list[dict], chunks_by_id: dict[str, dict]) -> list[dict]:
    """Add source_display (human-readable) to each question."""
    for q in questions:
        cited = q.get("source_chunk_ids") or []
        displays = []
        for cid in cited:
            c = chunks_by_id.get(cid)
            if c:
                parts = [
                    c.get("course_name") or "",
                    c.get("module_name") or "",
                    c.get("document_title") or cid,
                ]
                displays.append(" | ".join(p for p in parts if p))
            else:
                displays.append(cid)
        q["source_display"] = displays
    return questions


def generate_questions(
    course_id: str,
    query: str,
    num_questions: int = 5,
    unit_id: str = "",
    topic_id: str = "",
    subtopic_id: str = "",
) -> dict[str, Any]:
    """
    Retrieve chunks for course_id + query (optionally scoped to unit/topic/subtopic), then generate practice questions via Gemini.
    Returns dict with "questions" (list with source_chunk_ids and source_display) or "error".
    """
    if not query or not query.strip():
        return {"error": "query is required"}

    query_embedding = embed_text(query.strip())
    chunks = retrieve_chunks(
        course_id=course_id,
        query_embedding=query_embedding,
        top_k=RETRIEVAL_TOP_K,
        similarity_threshold=RETRIEVAL_THRESHOLD,
        unit_id=unit_id or "",
        topic_id=topic_id or "",
        subtopic_id=subtopic_id or "",
    )
    if len(chunks) < RETRIEVAL_MIN_CHUNKS:
        return {"error": FAILURE_MESSAGE, "questions": []}

    prompt = _build_rag_prompt(chunks, query.strip(), num_questions)
    client = _get_client()
    response = client.models.generate_content(
        model=GEMINI_GENERATION_MODEL,
        contents=prompt,
    )
    text = response.text if hasattr(response, "text") else str(response)
    questions = _parse_questions_json(text)
    valid_ids = {c["chunk_id"] for c in chunks}
    questions = _validate_citations(questions, valid_ids)
    chunks_by_id = {c["chunk_id"]: c for c in chunks}
    questions = _add_readable_sources(questions, chunks_by_id)

    return {"questions": questions, "retrieved_chunk_count": len(chunks)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate practice questions from course RAG")
    ap.add_argument("--course-id", type=str, required=True, help="Canvas course ID")
    ap.add_argument("--query", type=str, required=True, help="Topic or query for retrieval")
    ap.add_argument("--num-questions", type=int, default=5, help="Number of questions (default 5)")
    ap.add_argument("--unit-id", type=str, default="", help="Limit retrieval to this lesson-plan unit")
    ap.add_argument("--topic-id", type=str, default="", help="Limit retrieval to this topic")
    ap.add_argument("--subtopic-id", type=str, default="", help="Limit retrieval to this subtopic")
    args = ap.parse_args()

    result = generate_questions(
        course_id=args.course_id,
        query=args.query,
        num_questions=args.num_questions,
        unit_id=args.unit_id,
        topic_id=args.topic_id,
        subtopic_id=args.subtopic_id,
    )
    if result.get("error"):
        print(result["error"], file=sys.stderr)
        sys.exit(1)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
