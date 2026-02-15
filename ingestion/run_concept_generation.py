"""
Run the full concept/lesson-plan pipeline for a course using existing RAG data:
  1. Build lesson plan (units → topics → subtopics) from syllabus or chunk content
  2. Tag all chunks to that plan (batched LLM)
  3. Print the resulting conceptual structure (and chunk counts)
  4. Merge this course into public/classNames.json (course-level schema for multiple classes; frontend reads this)

Requires: course already ingested (documents + chunks in Snowflake). Run ingest_course.py first.

Usage:
  python run_concept_generation.py --course-id 45110000000215700 --course-name "Intro Computer Organization I"
  python run_concept_generation.py --course-id 45110000000215700 --course-name "Intro Computer Organization I" --json
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from build_lesson_plan import build_lesson_plan_for_course
from snowflake_rag import get_chunks_for_course, get_course_name, list_conceptual_units
from tag_chunks import tag_chunks_for_course

REPO_ROOT = Path(__file__).resolve().parent.parent
CLASSNAMES_JSON_PATH = REPO_ROOT / "public" / "classNames.json"


def _load_class_names_json() -> dict:
    """Load existing classNames.json or return empty structure."""
    if not CLASSNAMES_JSON_PATH.exists():
        return {"classes": [], "classNames": []}
    try:
        data = json.loads(CLASSNAMES_JSON_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "classes" in data:
            return data
        return {"classes": [], "classNames": []}
    except Exception:
        return {"classes": [], "classNames": []}


def _merge_course_into_class_names(
    course_id: str, course_name: str, units: list, updated_at: str
) -> dict:
    """Merge one course (courseId, className, units) into classNames.json structure. Returns full payload to write."""
    data = _load_class_names_json()
    classes = list(data.get("classes") or [])
    if not isinstance(classes, list):
        classes = []
    # Normalize: ensure each entry has className; match by courseId or className
    display_name = (course_name or "").strip() or course_id
    new_entry = {
        "className": display_name,
        "courseId": course_id,
        "units": units,
    }
    found = False
    for i, c in enumerate(classes):
        if not isinstance(c, dict):
            continue
        if c.get("courseId") == course_id:
            classes[i] = {**c, **new_entry}
            found = True
            break
        if (c.get("className") or "").strip() == display_name:
            classes[i] = {**c, **new_entry}
            found = True
            break
    if not found:
        classes.append(new_entry)
    class_names = []
    for c in classes:
        if isinstance(c, dict) and c.get("className"):
            class_names.append((c.get("className") or "").strip())
    class_names = [n for n in class_names if n]
    return {
        "classes": classes,
        "classNames": class_names,
        "updatedAt": updated_at,
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Build lesson plan from RAG content, tag chunks, then list conceptual units"
    )
    ap.add_argument("--course-id", type=str, required=True, help="Canvas course ID (must be already ingested)")
    ap.add_argument("--course-name", type=str, default="", help="Course name (used when building plan from content)")
    ap.add_argument("--batch-size", type=int, default=10, help="Chunks per LLM call for tagging (default 10)")
    ap.add_argument("--json", action="store_true", help="Output final units as JSON only (no progress)")
    args = ap.parse_args()

    course_id = args.course_id.strip()
    if not course_id:
        print("Error: --course-id is required", file=sys.stderr)
        sys.exit(1)

    # 1. Check we have chunks (existing RAG inputs)
    chunks = get_chunks_for_course(course_id)
    if not chunks:
        print(
            f"No chunks found for course {course_id}. Run ingest_course.py --course-id {course_id} first.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not args.json:
        print(f"Course {course_id}: {len(chunks)} chunks found. Building lesson plan...")

    # 2. Build lesson plan (from syllabus or from sampled chunks)
    plan_result = build_lesson_plan_for_course(course_id, args.course_name or course_id)
    units_plan = plan_result.get("units") or []
    if not units_plan:
        print("Failed to build a lesson plan (no units). Check syllabus or chunk content.", file=sys.stderr)
        sys.exit(1)
    if not args.json:
        print(f"  Plan built ({len(units_plan)} units, source: {plan_result.get('source', '?')}). Tagging chunks...")

    # 3. Tag chunks to unit/topic/subtopic
    tag_result = tag_chunks_for_course(course_id, args.batch_size)
    if tag_result.get("error"):
        print(f"Tagging error: {tag_result['error']}", file=sys.stderr)
        sys.exit(1)
    if not args.json:
        print(f"  Tagged {tag_result.get('tagged', 0)} assignments in {tag_result.get('batches', 0)} batches.")

    # 4. List conceptual units (with chunk counts)
    units = list_conceptual_units(course_id)
    course_name = get_course_name(course_id)
    payload = {
        "courseId": course_id,
        "courseName": course_name or "",
        "units": units,
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    updated_at = payload["updatedAt"]

    # 5. Merge into public/classNames.json (course-level schema for multiple classes)
    try:
        CLASSNAMES_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        class_names_payload = _merge_course_into_class_names(
            course_id, course_name or "", units, updated_at
        )
        CLASSNAMES_JSON_PATH.write_text(
            json.dumps(class_names_payload, indent=2), encoding="utf-8"
        )
        if not args.json:
            print(f"\nWrote {CLASSNAMES_JSON_PATH} (classes: {len(class_names_payload['classes'])})")
    except Exception as e:
        if not args.json:
            print(f"  (Could not write classNames.json: {e})", file=sys.stderr)

    if args.json:
        print(json.dumps(payload, indent=2))
        return
    print(f"\nConceptual structure for course {course_name or course_id}:\n")
    for u in units:
        print(f"  {u.get('unit_id', '?')}: {u.get('unit_name', '')} (chunks: {u.get('chunk_count', 0)})")
        for t in u.get("topics") or []:
            print(f"    Topic {t.get('topic_id', '?')}: {t.get('topic_name', '')} (chunks: {t.get('chunk_count', 0)})")
            for s in t.get("subtopics") or []:
                print(f"      Subtopic {s.get('subtopic_id', '?')}: {s.get('subtopic_name', '')} (chunks: {s.get('chunk_count', 0)})")
    print("\nDone. Use these unit_id / topic_id / subtopic_id with generate_questions.py --unit-id etc.")


if __name__ == "__main__":
    main()
