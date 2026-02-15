"""
Tag document chunks with unit/topic/subtopic from the lesson plan (batched LLM calls).
A chunk can have multiple assignments and will appear when queried by any of its tags.
Run after build_lesson_plan.py. Re-running overwrites assignments for the course.
Usage:
  python tag_chunks.py --course-id 45110000000215700 --batch-size 10
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

from google import genai

from config import GEMINI_API_KEY, GEMINI_GENERATION_MODEL
from snowflake_rag import (
    delete_chunk_assignments_for_course,
    get_chunks_for_course,
    get_lesson_plan,
    upsert_chunk_assignment,
)

BATCH_SIZE_DEFAULT = 10
_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY required")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _plan_summary(plan: dict[str, Any]) -> str:
    """Build a compact list of valid unit/topic/subtopic IDs and names for the prompt."""
    lines = ["Valid IDs (use these exact strings in your response):"]
    for u in plan.get("units") or []:
        uid = u.get("unit_id") or ""
        uname = u.get("unit_name") or ""
        lines.append(f"  Unit: {uid} = {uname}")
        for t in u.get("topics") or []:
            tid = t.get("topic_id") or ""
            tname = t.get("topic_name") or ""
            lines.append(f"    Topic: {tid} = {tname} (unit {uid})")
            for s in t.get("subtopics") or []:
                sid = s.get("subtopic_id") if isinstance(s, dict) else ""
                sname = s.get("subtopic_name", s) if isinstance(s, dict) else str(s)
                if isinstance(s, dict):
                    lines.append(f"      Subtopic: {sid} = {sname} (topic {tid})")
    return "\n".join(lines)


def _build_tag_prompt(plan_summary: str, chunks_batch: list[dict[str, Any]]) -> str:
    chunk_blobs = []
    for c in chunks_batch:
        cid = c.get("chunk_id") or ""
        text = (c.get("text") or "")[:600].strip()
        chunk_blobs.append(f"[chunk_id: {cid}]\n{text}")
    chunks_block = "\n\n".join(chunk_blobs)
    return f"""You are assigning course chunks to a lesson plan hierarchy (unit, optional topic, optional subtopic).

{plan_summary}

Chunks to assign (each can have MULTIPLE assignments if it spans units/topics):
{chunks_block}

For each chunk_id, output one or more assignments. Use ONLY the unit_id, topic_id, subtopic_id values from the list above. Use empty string "" for topic_id or subtopic_id if the chunk is only assigned to a unit.
Return ONLY valid JSON (no markdown) in this format:
{{"assignments": [{{"chunk_id": "...", "unit_id": "...", "topic_id": "...", "subtopic_id": "..."}}, ...]}}
Include every chunk_id at least once. A chunk can appear multiple times with different (unit_id, topic_id, subtopic_id)."""


def _parse_assignments(response_text: str) -> list[dict[str, Any]]:
    text = (response_text or "").strip()
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        text = m.group(1).strip()
    try:
        data = json.loads(text)
        return data.get("assignments") if isinstance(data, dict) else []
    except json.JSONDecodeError:
        return []


def tag_chunks_for_course(course_id: str, batch_size: int = BATCH_SIZE_DEFAULT) -> dict[str, Any]:
    """
    Load lesson plan and chunks, then in batches call Gemini to assign (unit, topic, subtopic).
    Replaces all existing chunk_assignments for this course.
    """
    plan = get_lesson_plan(course_id)
    if not plan.get("units"):
        return {"tagged": 0, "batches": 0, "error": "No lesson plan for this course. Run build_lesson_plan.py first."}

    delete_chunk_assignments_for_course(course_id)
    chunks = get_chunks_for_course(course_id)
    if not chunks:
        return {"tagged": 0, "batches": 0, "message": "No chunks for this course. Run ingest_course.py first."}

    plan_summary = _plan_summary(plan)
    client = _get_client()
    valid_units = {u["unit_id"] for u in plan["units"]}
    valid_topics: set[str] = set()
    valid_subtopics: set[str] = set()
    for u in plan["units"]:
        for t in u.get("topics") or []:
            valid_topics.add(t["topic_id"])
            for s in t.get("subtopics") or []:
                if isinstance(s, dict):
                    valid_subtopics.add(s.get("subtopic_id") or "")

    tagged_count = 0
    batch_count = 0
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        prompt = _build_tag_prompt(plan_summary, batch)
        try:
            response = client.models.generate_content(
                model=GEMINI_GENERATION_MODEL,
                contents=prompt,
            )
            text = response.text if hasattr(response, "text") else str(response)
        except Exception as e:
            return {"tagged": tagged_count, "batches": batch_count, "error": str(e)}
        assignments = _parse_assignments(text)
        for a in assignments:
            cid = a.get("chunk_id")
            uid = (a.get("unit_id") or "").strip()
            tid = (a.get("topic_id") or "").strip()
            sid = (a.get("subtopic_id") or "").strip()
            if not cid or uid not in valid_units:
                continue
            if tid and tid not in valid_topics:
                tid = ""
            if sid and sid not in valid_subtopics:
                sid = ""
            try:
                upsert_chunk_assignment(cid, uid, tid, sid)
                tagged_count += 1
            except Exception:
                pass
        batch_count += 1

    return {"tagged": tagged_count, "batches": batch_count, "chunks_total": len(chunks)}


def main() -> None:
    ap = argparse.ArgumentParser(description="Tag chunks with unit/topic/subtopic (batched)")
    ap.add_argument("--course-id", type=str, required=True, help="Course ID")
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE_DEFAULT, help="Chunks per LLM call")
    ap.add_argument("--json", action="store_true", help="Output JSON")
    args = ap.parse_args()
    try:
        result = tag_chunks_for_course(args.course_id, args.batch_size)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result.get("error"):
            print(result["error"], file=sys.stderr)
            sys.exit(1)
        print(f"Tagged {result.get('tagged', 0)} assignments in {result.get('batches', 0)} batches ({result.get('chunks_total', 0)} chunks).")


if __name__ == "__main__":
    main()
