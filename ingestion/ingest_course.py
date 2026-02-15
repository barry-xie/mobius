"""
Knot RAG ingestion: Canvas -> raw documents (with download + HTML text) -> chunk -> embed -> Snowflake RAG schema.
Usage:
  python ingest_course.py                    # ingest all courses
  python ingest_course.py --course-id 12345  # ingest single course
"""
from __future__ import annotations

import argparse
import sys
from typing import Any

from canvas_client import (
    download_file,
    fetch_assignments,
    fetch_courses,
    fetch_files,
    fetch_modules,
    fetch_page_body,
    fetch_pages,
    fetch_syllabus,
)
from chunking import chunk_text
from config import CANVAS_API_KEY
from embedding import embed_text
from extractors import extract_text_from_file, html_to_text
from snowflake_rag import (
    delete_chunks_by_document_id,
    ensure_rag_schema,
    generate_chunk_id,
    insert_chunk,
    insert_course,
    insert_document,
    insert_module,
)


def _module_item_map(modules: list[dict]) -> dict[tuple[str, str], str]:
    """(content_type, content_id) -> module_id. Content type: Assignment, File, Page, etc."""
    out = {}
    for mod in modules:
        mod_id = str(mod.get("id") or "")
        for item in mod.get("items") or []:
            ctype = (item.get("type") or "").strip()
            cid = str(item.get("content_id") or item.get("page_url") or "")
            if ctype and cid:
                out[(ctype, cid)] = mod_id
    return out


def _ingest_document(
    course_id: str,
    module_id: str,
    document_id: str,
    document_type: str,
    title: str,
    raw_text: str,
    course_name: str = "",
    module_name: str = "",
) -> None:
    if not raw_text or not raw_text.strip():
        return
    insert_document(
        document_id=document_id,
        course_id=course_id,
        module_id=module_id or "uncategorized",
        document_type=document_type,
        title=title or document_id,
        raw_text=raw_text,
    )
    delete_chunks_by_document_id(document_id)
    document_title = title or document_id
    chunks = chunk_text(raw_text)
    for i, chunk_text_val in enumerate(chunks):
        chunk_id = generate_chunk_id()
        embedding = embed_text(chunk_text_val)
        insert_chunk(
            chunk_id=chunk_id,
            document_id=document_id,
            course_id=course_id,
            module_id=module_id or "uncategorized",
            text=chunk_text_val,
            embedding=embedding,
            document_title=document_title,
            course_name=course_name,
            module_name=module_name,
        )


def ingest_course(course_id_arg: str | None = None) -> None:
    token = CANVAS_API_KEY
    if not token:
        print("Error: CANVAS_API not set in .env", file=sys.stderr)
        sys.exit(1)

    ensure_rag_schema()
    courses = fetch_courses(token)
    if course_id_arg:
        courses = [c for c in courses if str(c.get("id")) == str(course_id_arg)]
        if not courses:
            print(f"Error: course id {course_id_arg} not found", file=sys.stderr)
            sys.exit(1)

    for course in courses:
        cid = str(course["id"])
        cname = (course.get("name") or "").strip() or cid
        print(f"Course: {cid} {cname}")
        insert_course(course_id=cid, course_name=cname)

        modules = fetch_modules(token, cid)
        item_map = _module_item_map(modules)
        module_name_by_id = {
            str(mod["id"]): (mod.get("name") or "").strip() or str(mod["id"])
            for mod in modules
        }
        for mod in modules:
            insert_module(
                module_id=str(mod["id"]),
                course_id=cid,
                module_name=(mod.get("name") or "").strip() or str(mod["id"]),
            )

        # Syllabus
        syllabus_html = fetch_syllabus(token, cid)
        if syllabus_html:
            text = html_to_text(syllabus_html)
            _ingest_document(
                course_id=cid,
                module_id="",
                document_id=f"syllabus_{cid}",
                document_type="syllabus",
                title=f"Syllabus: {cname}",
                raw_text=text,
                course_name=cname,
                module_name="",
            )

        # Assignments (description HTML)
        for a in fetch_assignments(token, cid):
            desc = a.get("description") or ""
            text = html_to_text(desc)
            if not text.strip():
                continue
            doc_id = f"assignment_{a['id']}"
            mod_id = item_map.get(("Assignment", str(a["id"])), "")
            _ingest_document(
                course_id=cid,
                module_id=mod_id,
                document_id=doc_id,
                document_type="assignment",
                title=(a.get("name") or "").strip() or doc_id,
                raw_text=text,
                course_name=cname,
                module_name=module_name_by_id.get(mod_id, "") if mod_id else "",
            )

        # Pages (body HTML)
        for p in fetch_pages(token, cid):
            url_slug = p.get("url") or p.get("page_id") or ""
            if not url_slug:
                continue
            body = fetch_page_body(token, cid, url_slug)
            if not body:
                continue
            text = html_to_text(body)
            if not text.strip():
                continue
            doc_id = f"page_{cid}_{url_slug}"
            mod_id = item_map.get(("Page", url_slug), "")
            _ingest_document(
                course_id=cid,
                module_id=mod_id,
                document_id=doc_id,
                document_type="page",
                title=(p.get("title") or "").strip() or url_slug,
                raw_text=text,
                course_name=cname,
                module_name=module_name_by_id.get(mod_id, "") if mod_id else "",
            )

        # Files (download and extract text)
        for f in fetch_files(token, cid):
            url = f.get("url")
            if not url:
                continue
            raw = download_file(token, url)
            if not raw:
                continue
            filename = f.get("display_name") or f.get("filename") or ""
            text = extract_text_from_file(raw, filename)
            if not text.strip():
                continue
            doc_id = f"file_{f['id']}"
            mod_id = item_map.get(("File", str(f["id"])), "")
            _ingest_document(
                course_id=cid,
                module_id=mod_id,
                document_id=doc_id,
                document_type="file",
                title=(f.get("display_name") or filename or doc_id).strip(),
                raw_text=text,
                course_name=cname,
                module_name=module_name_by_id.get(mod_id, "") if mod_id else "",
            )

    print("Ingest done.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest Canvas course(s) into Knot RAG (Snowflake)")
    ap.add_argument("--course-id", type=str, default=None, help="Optional: single course ID")
    args = ap.parse_args()
    ingest_course(course_id_arg=args.course_id)


if __name__ == "__main__":
    main()
