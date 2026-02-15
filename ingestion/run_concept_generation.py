"""
Run the full concept/lesson-plan pipeline for a course using existing RAG data:
  1. Build lesson plan (units → topics → subtopics) from syllabus or chunk content
  2. Tag all chunks to that plan (batched LLM)
  3. Print the resulting conceptual structure (and chunk counts)

Requires: course already ingested (documents + chunks in Snowflake). Run ingest_course.py first.

Usage:
  python run_concept_generation.py --course-id 45110000000215700 --course-name "Intro Computer Organization I"
  python run_concept_generation.py --course-id 45110000000215700 --course-name "Intro Computer Organization I" --json
"""
from __future__ import annotations

import argparse
import json
import sys

from build_lesson_plan import build_lesson_plan_for_course
from snowflake_rag import get_chunks_for_course, list_conceptual_units
from tag_chunks import tag_chunks_for_course


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
    if args.json:
        print(json.dumps(units, indent=2))
        return
    print(f"\nConceptual structure for course {course_id}:\n")
    for u in units:
        print(f"  {u.get('unit_id', '?')}: {u.get('unit_name', '')} (chunks: {u.get('chunk_count', 0)})")
        for t in u.get("topics") or []:
            print(f"    Topic {t.get('topic_id', '?')}: {t.get('topic_name', '')} (chunks: {t.get('chunk_count', 0)})")
            for s in t.get("subtopics") or []:
                print(f"      Subtopic {s.get('subtopic_id', '?')}: {s.get('subtopic_name', '')} (chunks: {s.get('chunk_count', 0)})")
    print("\nDone. Use these unit_id / topic_id / subtopic_id with generate_questions.py --unit-id etc.")


if __name__ == "__main__":
    main()
