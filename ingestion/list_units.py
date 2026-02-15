"""
List a course's units: Canvas modules (default) or conceptual lesson-plan units (--conceptual).
Use --conceptual after build_lesson_plan.py and tag_chunks.py to see unit/topic/subtopic and chunk counts.
Usage:
  python list_units.py --course-id 45110000000215700
  python list_units.py --course-id 45110000000215700 --conceptual
"""
from __future__ import annotations

import argparse
import json
import sys

from snowflake_rag import get_course_name, list_conceptual_units, list_units


def main() -> None:
    ap = argparse.ArgumentParser(description="List units (modules or conceptual) for a course")
    ap.add_argument("--course-id", type=str, required=True, help="Canvas course ID")
    ap.add_argument("--conceptual", action="store_true", help="List lesson-plan units/topics/subtopics with chunk counts")
    ap.add_argument("--json", action="store_true", help="Output raw JSON (conceptual: includes courseId, courseName, units)")
    args = ap.parse_args()

    try:
        if args.conceptual:
            units = list_conceptual_units(args.course_id)
            course_name = get_course_name(args.course_id)
            if args.json:
                out = {"courseId": args.course_id, "courseName": course_name or "", "units": units}
                print(json.dumps(out, indent=2))
                return
        else:
            units = list_units(args.course_id)
            if args.json:
                print(json.dumps(units, indent=2))
                return
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if not units:
        msg = "No conceptual units. Run build_lesson_plan.py and tag_chunks.py first." if args.conceptual else "No units found for this course. Run ingest_course.py first."
        print(msg)
        return

    if args.conceptual:
        display_name = course_name.strip() or args.course_id
        print(f"Course {display_name} – {len(units)} conceptual unit(s)\n")
        for u in units:
            print(f"  {u.get('unit_id', '?')}: {u.get('unit_name', '')} (chunks: {u.get('chunk_count', 0)})")
            for t in u.get("topics") or []:
                print(f"    Topic {t.get('topic_id', '?')}: {t.get('topic_name', '')} (chunks: {t.get('chunk_count', 0)})")
                for s in t.get("subtopics") or []:
                    print(f"      Subtopic {s.get('subtopic_id', '?')}: {s.get('subtopic_name', '')} (chunks: {s.get('chunk_count', 0)})")
    else:
        print(f"Course {args.course_id} – {len(units)} unit(s)\n")
        for u in units:
            name = (u.get("module_name") or "").strip() or u.get("module_id", "?")
            docs = u.get("document_count") or 0
            chunks = u.get("chunk_count") or 0
            print(f"  {u.get('module_id', '?')}: {name}")
            print(f"    documents: {docs}, chunks: {chunks}")


if __name__ == "__main__":
    main()
