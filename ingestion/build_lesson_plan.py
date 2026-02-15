"""
Build a conceptual lesson plan (units -> topics -> subtopics) for a course.
Syllabus-first: if the course has a syllabus in RAG, use Gemini to extract the hierarchy.
Otherwise: sample course documents/chunks and use Gemini to propose a plan from content.
Usage:
  python build_lesson_plan.py --course-id 45110000000215700
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from typing import Any

from google import genai

from config import GEMINI_API_KEY, GEMINI_GENERATION_MODEL
from snowflake_rag import (
    ensure_rag_schema,
    get_chunks_for_course,
    get_lesson_plan,
    get_syllabus_text,
    insert_subtopic,
    insert_topic,
    insert_unit,
)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY required")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def _short_id() -> str:
    return uuid.uuid4().hex[:12]


def _extract_plan_from_syllabus(syllabus_text: str, course_name: str) -> dict[str, Any] | None:
    """Use Gemini to extract unit/topic/subtopic structure from syllabus text."""
    client = _get_client()
    prompt = f"""You are analyzing a course syllabus to extract a conceptual lesson plan.

Course: {course_name}

Syllabus text:
{syllabus_text[:12000]}

Extract a hierarchical structure: Units (major conceptual areas), each with optional Topics, each with optional Subtopics.
Example for "Data Structures": Unit "Trees" -> Topic "Binary Search Trees" -> Subtopics "Insertion", "Deletion".
Return ONLY valid JSON in this exact format (no markdown, no explanation):
{{"units": [{{"unit_name": "Name", "topics": [{{"topic_name": "Name", "subtopics": ["Name1", "Name2"]}}]}}]}}
Use empty arrays where there are no topics or subtopics. Be concise with names."""
    try:
        response = client.models.generate_content(
            model=GEMINI_GENERATION_MODEL,
            contents=prompt,
        )
        text = response.text if hasattr(response, "text") else str(response)
        text = text.strip()
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        return None


def _extract_plan_from_content(sample_texts: list[str], course_name: str) -> dict[str, Any] | None:
    """Use Gemini to propose a lesson plan from sampled course content."""
    client = _get_client()
    combined = "\n\n---\n\n".join((t[:800] for t in sample_texts[:15]))  # cap total context
    prompt = f"""You are creating a conceptual lesson plan for a course based on sample content.

Course: {course_name}

Sample content from course materials:
{combined[:10000]}

Propose a hierarchy: Units (major conceptual areas), each with optional Topics, each with optional Subtopics.
Return ONLY valid JSON in this format (no markdown):
{{"units": [{{"unit_name": "Name", "topics": [{{"topic_name": "Name", "subtopics": ["Name1", "Name2"]}}]}}]}}
Use empty arrays where needed. Be concise."""
    try:
        response = client.models.generate_content(
            model=GEMINI_GENERATION_MODEL,
            contents=prompt,
        )
        text = response.text if hasattr(response, "text") else str(response)
        text = text.strip()
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
        return json.loads(text)
    except (json.JSONDecodeError, Exception):
        return None


def build_lesson_plan_for_course(course_id: str, course_name: str = "") -> dict[str, Any]:
    """
    Build and store lesson plan. Syllabus-first; fallback to LLM from content.
    Returns the stored plan (units with nested topics/subtopics and ids).
    """
    ensure_rag_schema()
    syllabus = get_syllabus_text(course_id)
    plan_data = None
    source = "syllabus"
    if syllabus and len(syllabus.strip()) > 100:
        plan_data = _extract_plan_from_syllabus(syllabus, course_name or course_id)
    if not plan_data or not plan_data.get("units"):
        chunks = get_chunks_for_course(course_id)
        sample_texts = [c.get("text") or "" for c in chunks if (c.get("text") or "").strip()][:20]
        if sample_texts:
            source = "content"
            plan_data = _extract_plan_from_content(sample_texts, course_name or course_id)
    if not plan_data or not plan_data.get("units"):
        return {"units": [], "source": "none", "message": "Could not extract or generate a lesson plan."}

    sort_order = 0
    for u in plan_data["units"]:
        unit_name = (u.get("unit_name") or "").strip()
        if not unit_name:
            continue
        unit_id = _short_id()
        insert_unit(unit_id, course_id, unit_name, sort_order)
        sort_order += 1
        for t in u.get("topics") or []:
            topic_name = (t.get("topic_name") or "").strip()
            if not topic_name:
                continue
            topic_id = _short_id()
            insert_topic(topic_id, unit_id, topic_name, 0)
            for i, sub_name in enumerate(t.get("subtopics") or []):
                sub_name = (sub_name if isinstance(sub_name, str) else str(sub_name)).strip()
                if not sub_name:
                    continue
                insert_subtopic(_short_id(), topic_id, sub_name, i)

    return {**get_lesson_plan(course_id), "source": source}


def main() -> None:
    ap = argparse.ArgumentParser(description="Build conceptual lesson plan (units/topics/subtopics) for a course")
    ap.add_argument("--course-id", type=str, required=True, help="Course ID")
    ap.add_argument("--course-name", type=str, default="", help="Course name (for LLM context)")
    ap.add_argument("--json", action="store_true", help="Output plan as JSON")
    args = ap.parse_args()
    try:
        plan = build_lesson_plan_for_course(args.course_id, args.course_name)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    if args.json:
        print(json.dumps(plan, indent=2))
    else:
        if not plan.get("units"):
            print(plan.get("message", "No units in plan."))
            return
        print(f"Lesson plan ({plan.get('source', '?')}): {len(plan['units'])} unit(s)\n")
        for u in plan["units"]:
            print(f"  {u['unit_name']} ({u['unit_id']})")
            for t in u.get("topics") or []:
                print(f"    - {t['topic_name']} ({t['topic_id']})")
                for s in t.get("subtopics") or []:
                    print(f"      - {s.get('subtopic_name', s)}")


if __name__ == "__main__":
    main()
