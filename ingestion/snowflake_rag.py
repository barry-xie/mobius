"""
Snowflake client for RAG: separate schema (RAG) under the same database.
Uses REST API with token auth to match existing getCanvas.js setup.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

import requests

from config import (
    SNOWFLAKE_DATABASE,
    SNOWFLAKE_HOST,
    SNOWFLAKE_RAG_SCHEMA,
    SNOWFLAKE_ROLE,
    SNOWFLAKE_TOKEN,
    SNOWFLAKE_TOKEN_TYPE,
    SNOWFLAKE_WAREHOUSE,
)

ENDPOINT = f"https://{SNOWFLAKE_HOST}/api/v2/statements" if SNOWFLAKE_HOST else ""


def _headers() -> dict[str, str]:
    h = {
        "Authorization": f"Bearer {SNOWFLAKE_TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if SNOWFLAKE_TOKEN_TYPE:
        h["X-Snowflake-Authorization-Token-Type"] = SNOWFLAKE_TOKEN_TYPE
    return h


def _body(
    statement: str,
    bindings: dict | None = None,
    timeout: int = 120,
    include_database: bool = True,
    include_schema: bool = True,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "statement": statement,
        "timeout": timeout,
        "warehouse": SNOWFLAKE_WAREHOUSE,
    }
    if include_database:
        body["database"] = SNOWFLAKE_DATABASE
    if include_schema:
        body["schema"] = SNOWFLAKE_RAG_SCHEMA
    if SNOWFLAKE_ROLE:
        body["role"] = SNOWFLAKE_ROLE
    if bindings:
        body["bindings"] = bindings
    return body


def execute(
    statement: str,
    bindings: dict | None = None,
    timeout: int = 120,
    include_database: bool = True,
    include_schema: bool = True,
) -> dict[str, Any]:
    resp = requests.post(
        ENDPOINT,
        headers=_headers(),
        json=_body(statement, bindings, timeout, include_database, include_schema),
    )
    raw = resp.text
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {}
    if not resp.ok:
        raise RuntimeError(f"Snowflake error ({resp.status_code}): {raw}")
    return data


def ensure_rag_schema() -> None:
    """Create database if needed, then RAG schema and RAG tables."""
    execute(
        "CREATE DATABASE IF NOT EXISTS " + SNOWFLAKE_DATABASE,
        timeout=60,
        include_database=False,
        include_schema=False,
    )
    execute(
        f"CREATE SCHEMA IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}",
        timeout=60,
        include_schema=False,
    )

    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.courses (
            course_id STRING PRIMARY KEY,
            course_name STRING,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """,
        timeout=60,
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.modules (
            module_id STRING PRIMARY KEY,
            course_id STRING,
            module_name STRING,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.documents (
            document_id STRING PRIMARY KEY,
            course_id STRING,
            module_id STRING,
            document_type STRING,
            title STRING,
            raw_text STRING,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            updated_at TIMESTAMP_NTZ
        )
        """
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks (
            chunk_id STRING PRIMARY KEY,
            document_id STRING,
            course_id STRING,
            module_id STRING,
            text STRING,
            embedding VECTOR(FLOAT, 768),
            trust_score FLOAT DEFAULT 1.0,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            updated_at TIMESTAMP_NTZ,
            document_title STRING,
            course_name STRING,
            module_name STRING
        )
        """
    )
    _add_chunk_traceability_columns_if_missing()

    # Conceptual lesson plan: unit -> topic -> subtopic (for scoped generation)
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.units (
            unit_id STRING PRIMARY KEY,
            course_id STRING,
            unit_name STRING,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.topics (
            topic_id STRING PRIMARY KEY,
            unit_id STRING,
            topic_name STRING,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.subtopics (
            subtopic_id STRING PRIMARY KEY,
            topic_id STRING,
            subtopic_name STRING,
            sort_order INT DEFAULT 0,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
        )
        """
    )
    execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.chunk_assignments (
            chunk_id STRING,
            unit_id STRING,
            topic_id STRING,
            subtopic_id STRING,
            created_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
            PRIMARY KEY (chunk_id, unit_id, topic_id, subtopic_id)
        )
        """
    )


def _add_chunk_traceability_columns_if_missing() -> None:
    """Add human-readable source columns to document_chunks if table existed from before."""
    for col in ("document_title", "course_name", "module_name"):
        try:
            execute(
                f"ALTER TABLE {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks ADD COLUMN {col} STRING"
            )
        except RuntimeError as e:
            if "already exists" not in str(e).lower():
                raise


def _bind(index: int, value: str | None) -> dict:
    v = "" if value is None else str(value)
    return {str(index): {"type": "TEXT", "value": v}}


def insert_course(course_id: str, course_name: str) -> None:
    bind = {**_bind(1, course_id), **_bind(2, course_name)}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.courses t
        USING (SELECT ? AS course_id, ? AS course_name) s ON t.course_id = s.course_id
        WHEN MATCHED THEN UPDATE SET t.course_name = s.course_name
        WHEN NOT MATCHED THEN INSERT (course_id, course_name) VALUES (s.course_id, s.course_name)
        """,
        bindings=bind,
    )


def insert_module(module_id: str, course_id: str, module_name: str) -> None:
    bind = {**_bind(1, module_id), **_bind(2, course_id), **_bind(3, module_name)}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.modules t
        USING (SELECT ? AS module_id, ? AS course_id, ? AS module_name) s ON t.module_id = s.module_id
        WHEN MATCHED THEN UPDATE SET t.module_name = s.module_name, t.course_id = s.course_id
        WHEN NOT MATCHED THEN INSERT (module_id, course_id, module_name) VALUES (s.module_id, s.course_id, s.module_name)
        """,
        bindings=bind,
    )


def insert_unit(unit_id: str, course_id: str, unit_name: str, sort_order: int = 0) -> None:
    bind = {**_bind(1, unit_id), **_bind(2, course_id), **_bind(3, unit_name), **_bind(4, str(sort_order))}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.units t
        USING (SELECT ? AS unit_id, ? AS course_id, ? AS unit_name, ? AS sort_order) s ON t.unit_id = s.unit_id
        WHEN MATCHED THEN UPDATE SET t.unit_name = s.unit_name, t.course_id = s.course_id, t.sort_order = s.sort_order
        WHEN NOT MATCHED THEN INSERT (unit_id, course_id, unit_name, sort_order) VALUES (s.unit_id, s.course_id, s.unit_name, s.sort_order)
        """,
        bindings=bind,
    )


def insert_topic(topic_id: str, unit_id: str, topic_name: str, sort_order: int = 0) -> None:
    bind = {**_bind(1, topic_id), **_bind(2, unit_id), **_bind(3, topic_name), **_bind(4, str(sort_order))}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.topics t
        USING (SELECT ? AS topic_id, ? AS unit_id, ? AS topic_name, ? AS sort_order) s ON t.topic_id = s.topic_id
        WHEN MATCHED THEN UPDATE SET t.topic_name = s.topic_name, t.unit_id = s.unit_id, t.sort_order = s.sort_order
        WHEN NOT MATCHED THEN INSERT (topic_id, unit_id, topic_name, sort_order) VALUES (s.topic_id, s.unit_id, s.topic_name, s.sort_order)
        """,
        bindings=bind,
    )


def insert_subtopic(subtopic_id: str, topic_id: str, subtopic_name: str, sort_order: int = 0) -> None:
    bind = {**_bind(1, subtopic_id), **_bind(2, topic_id), **_bind(3, subtopic_name), **_bind(4, str(sort_order))}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.subtopics t
        USING (SELECT ? AS subtopic_id, ? AS topic_id, ? AS subtopic_name, ? AS sort_order) s ON t.subtopic_id = s.subtopic_id
        WHEN MATCHED THEN UPDATE SET t.subtopic_name = s.subtopic_name, t.topic_id = s.topic_id, t.sort_order = s.sort_order
        WHEN NOT MATCHED THEN INSERT (subtopic_id, topic_id, subtopic_name, sort_order) VALUES (s.subtopic_id, s.topic_id, s.subtopic_name, s.sort_order)
        """,
        bindings=bind,
    )


def upsert_chunk_assignment(chunk_id: str, unit_id: str, topic_id: str = "", subtopic_id: str = "") -> None:
    """Assign a chunk to a (unit, topic, subtopic). Use '' for topic_id/subtopic_id when not applicable."""
    tid = topic_id or ""
    sid = subtopic_id or ""
    bind = {**_bind(1, chunk_id), **_bind(2, unit_id), **_bind(3, tid), **_bind(4, sid)}
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.chunk_assignments t
        USING (SELECT ? AS chunk_id, ? AS unit_id, ? AS topic_id, ? AS subtopic_id) s
        ON t.chunk_id = s.chunk_id AND t.unit_id = s.unit_id AND t.topic_id = s.topic_id AND t.subtopic_id = s.subtopic_id
        WHEN NOT MATCHED THEN INSERT (chunk_id, unit_id, topic_id, subtopic_id) VALUES (s.chunk_id, s.unit_id, s.topic_id, s.subtopic_id)
        """,
        bindings=bind,
    )


def delete_chunk_assignments_for_course(course_id: str) -> None:
    """Remove all chunk_assignments for chunks belonging to this course (so we can re-tag)."""
    bind = _bind(1, course_id)
    execute(
        f"""
        DELETE FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.chunk_assignments
        WHERE chunk_id IN (SELECT chunk_id FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks WHERE course_id = ?)
        """,
        bindings=bind,
    )


def insert_document(
    document_id: str,
    course_id: str,
    module_id: str,
    document_type: str,
    title: str,
    raw_text: str,
) -> None:
    bind = {
        **_bind(1, document_id),
        **_bind(2, course_id),
        **_bind(3, module_id),
        **_bind(4, document_type),
        **_bind(5, title),
        **_bind(6, raw_text),
    }
    execute(
        f"""
        MERGE INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.documents t
        USING (SELECT ? AS document_id, ? AS course_id, ? AS module_id, ? AS document_type, ? AS title, ? AS raw_text) s
        ON t.document_id = s.document_id
        WHEN MATCHED THEN UPDATE SET t.raw_text = s.raw_text, t.title = s.title, t.module_id = s.module_id
        WHEN NOT MATCHED THEN INSERT (document_id, course_id, module_id, document_type, title, raw_text) VALUES (s.document_id, s.course_id, s.module_id, s.document_type, s.title, s.raw_text)
        """,
        bindings=bind,
    )


def delete_chunks_by_document_id(document_id: str) -> None:
    bind = _bind(1, document_id)
    execute(
        f"""
        DELETE FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks
        WHERE document_id = ?
        """,
        bindings=bind,
    )


def insert_chunk(
    chunk_id: str,
    document_id: str,
    course_id: str,
    module_id: str,
    text: str,
    embedding: list[float],
    document_title: str = "",
    course_name: str = "",
    module_name: str = "",
) -> None:
    # Snowflake: pass vector as JSON array string; PARSE_JSON gives VARIANT, cast to VECTOR
    emb_str = json.dumps(embedding)
    bind = {
        "1": {"type": "TEXT", "value": chunk_id},
        "2": {"type": "TEXT", "value": document_id},
        "3": {"type": "TEXT", "value": course_id},
        "4": {"type": "TEXT", "value": module_id},
        "5": {"type": "TEXT", "value": text},
        "6": {"type": "TEXT", "value": emb_str},
        "7": {"type": "TEXT", "value": (document_title or "")[:65535]},
        "8": {"type": "TEXT", "value": (course_name or "")[:65535]},
        "9": {"type": "TEXT", "value": (module_name or "")[:65535]},
    }
    execute(
        f"""
        INSERT INTO {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks
        (chunk_id, document_id, course_id, module_id, text, embedding, document_title, course_name, module_name)
        SELECT ?, ?, ?, ?, ?, PARSE_JSON(?)::VECTOR(FLOAT, 768), ?, ?, ?
        """,
        bindings=bind,
    )


def generate_chunk_id() -> str:
    return str(uuid.uuid4())


def get_course_name(course_id: str) -> str:
    """Return course_name from RAG courses table for display; empty string if not found."""
    bind = _bind(1, course_id)
    sql = f"""
    SELECT COALESCE(course_name, '') FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.courses
    WHERE course_id = ?
    LIMIT 1
    """
    data = _execute_and_fetch(sql, bind)
    if not data or not data[0]:
        return ""
    return (data[0][0] or "").strip()


def get_syllabus_text(course_id: str) -> str | None:
    """Return raw_text of the syllabus document for the course, if any."""
    bind = _bind(1, course_id)
    sql = f"""
    SELECT raw_text FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.documents
    WHERE course_id = ? AND document_type = 'syllabus'
    LIMIT 1
    """
    data = _execute_and_fetch(sql, bind)
    if not data or not data[0]:
        return None
    return (data[0][0] or "").strip() or None


def get_chunks_for_course(course_id: str) -> list[dict[str, Any]]:
    """Return all chunks for a course (chunk_id, text, document_title) for tagging."""
    bind = _bind(1, course_id)
    sql = f"""
    SELECT chunk_id, text, COALESCE(document_title, '') AS document_title
    FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks
    WHERE course_id = ?
    ORDER BY chunk_id
    """
    data = _execute_and_fetch(sql, bind)
    columns = ["chunk_id", "text", "document_title"]
    return [_row_to_dict(columns, row) for row in data]


def get_lesson_plan(course_id: str) -> dict[str, Any]:
    """Return units with nested topics and subtopics for the course. Uses 3 batched queries."""
    bind = _bind(1, course_id)
    # 1. All units for the course
    units_sql = f"""
    SELECT unit_id, unit_name, sort_order FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.units
    WHERE course_id = ? ORDER BY sort_order, unit_id
    """
    units_data = _execute_and_fetch(units_sql, bind)
    if not units_data:
        return {"units": []}
    # 2. All topics for this course (join units to filter by course_id)
    topics_sql = f"""
    SELECT t.unit_id, t.topic_id, t.topic_name, t.sort_order
    FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.topics t
    INNER JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.units u ON u.unit_id = t.unit_id
    WHERE u.course_id = ? ORDER BY u.sort_order, u.unit_id, t.sort_order, t.topic_id
    """
    topics_data = _execute_and_fetch(topics_sql, bind)
    # 3. All subtopics for this course (join topics -> units to filter by course_id)
    subtopics_sql = f"""
    SELECT t.topic_id, s.subtopic_id, s.subtopic_name, s.sort_order
    FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.subtopics s
    INNER JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.topics t ON t.topic_id = s.topic_id
    INNER JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.units u ON u.unit_id = t.unit_id
    WHERE u.course_id = ? ORDER BY t.sort_order, t.topic_id, s.sort_order, s.subtopic_id
    """
    subtopics_data = _execute_and_fetch(subtopics_sql, bind)
    # Index topics by unit_id, subtopics by topic_id
    topics_by_unit: dict[str, list[dict[str, Any]]] = {}
    for row in topics_data:
        uid, tid, tname, torder = row[0], row[1], row[2] or "", row[3] or 0
        if uid not in topics_by_unit:
            topics_by_unit[uid] = []
        topics_by_unit[uid].append({"topic_id": tid, "topic_name": tname, "sort_order": torder, "subtopics": []})
    subtopics_by_topic: dict[str, list[dict[str, Any]]] = {}
    for row in subtopics_data:
        tid, sid, sname, sorder = row[0], row[1], row[2] or "", row[3] or 0
        if tid not in subtopics_by_topic:
            subtopics_by_topic[tid] = []
        subtopics_by_topic[tid].append({"subtopic_id": sid, "subtopic_name": (sname or "").strip(), "sort_order": sorder})
    # Build nested plan
    plan = {"units": []}
    for row in units_data:
        uid, uname, order = row[0], row[1] or "", row[2] or 0
        topics = topics_by_unit.get(uid, [])
        for topic in topics:
            topic["subtopics"] = subtopics_by_topic.get(topic["topic_id"], [])
        plan["units"].append({"unit_id": uid, "unit_name": uname, "sort_order": order, "topics": topics})
    return plan


def list_conceptual_units(course_id: str) -> list[dict[str, Any]]:
    """
    Return conceptual units (lesson plan) with nested topics/subtopics and chunk counts
    from chunk_assignments. Empty list if no lesson plan.
    """
    plan = get_lesson_plan(course_id)
    units_plan = plan.get("units") or []
    if not units_plan:
        return []

    # Count assignments per (unit_id, topic_id, subtopic_id)
    bind = _bind(1, course_id)
    sql = f"""
    SELECT a.unit_id, COALESCE(a.topic_id, '') AS topic_id, COALESCE(a.subtopic_id, '') AS subtopic_id, COUNT(*) AS cnt
    FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.chunk_assignments a
    INNER JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks c ON c.chunk_id = a.chunk_id
    WHERE c.course_id = ?
    GROUP BY a.unit_id, a.topic_id, a.subtopic_id
    """
    rows = _execute_and_fetch(sql, bind)
    count_map: dict[tuple[str, str, str], int] = {}
    for row in rows:
        try:
            cnt = int(row[3]) if len(row) > 3 and row[3] is not None else 0
        except (TypeError, ValueError):
            cnt = 0
        count_map[(row[0], row[1], row[2])] = cnt

    result: list[dict[str, Any]] = []
    for u in units_plan:
        uid = u.get("unit_id") or ""
        uname = u.get("unit_name") or ""
        unit_chunks = sum(v for (uid_k, _t, _s), v in count_map.items() if uid_k == uid)
        topics_out: list[dict[str, Any]] = []
        for t in u.get("topics") or []:
            tid = t.get("topic_id") or ""
            tname = t.get("topic_name") or ""
            topic_chunks = sum(v for (uid_k, tid_k, _s), v in count_map.items() if uid_k == uid and tid_k == tid)
            subtopics_out = []
            for s in t.get("subtopics") or []:
                if not isinstance(s, dict):
                    continue
                sid = s.get("subtopic_id") or ""
                sname = s.get("subtopic_name") or ""
                sub_chunks = count_map.get((uid, tid, sid), 0)
                subtopics_out.append({"subtopic_id": sid, "subtopic_name": sname, "chunk_count": sub_chunks})
            topics_out.append({"topic_id": tid, "topic_name": tname, "chunk_count": topic_chunks, "subtopics": subtopics_out})
        result.append({"unit_id": uid, "unit_name": uname, "chunk_count": unit_chunks, "topics": topics_out})
    return result


def list_units(course_id: str) -> list[dict[str, Any]]:
    """
    Return the course's units (modules) with human-readable names and document/chunk counts.
    Each row: module_id, module_name, document_count, chunk_count.
    """
    sql = f"""
    SELECT m.module_id, COALESCE(m.module_name, '') AS module_name,
           COUNT(DISTINCT d.document_id) AS document_count,
           COUNT(c.chunk_id) AS chunk_count
    FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.modules m
    LEFT JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.documents d
      ON d.course_id = m.course_id AND d.module_id = m.module_id
    LEFT JOIN {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks c
      ON c.document_id = d.document_id
    WHERE m.course_id = ?
    GROUP BY m.module_id, m.module_name, m.course_id
    ORDER BY m.module_id
    """
    bind = _bind(1, course_id)
    data = _execute_and_fetch(sql, bind)
    columns = ["module_id", "module_name", "document_count", "chunk_count"]
    return [_row_to_dict(columns, row) for row in data]


def retrieve_chunks(
    course_id: str,
    query_embedding: list[float],
    top_k: int = 8,
    similarity_threshold: float = 0.25,
    unit_id: str = "",
    topic_id: str = "",
    subtopic_id: str = "",
) -> list[dict[str, Any]]:
    """
    Return list of chunks with chunk_id, text, document_title, course_name, module_name, score.
    Optionally restrict to chunks that have an assignment for (unit_id, topic_id, subtopic_id).
    Use '' for any scope to leave it unconstrained. Requires at least 2 chunks above threshold
    for useful RAG; caller can check len >= 2.
    """
    emb_str = json.dumps(query_embedding)
    uid = unit_id or ""
    tid = topic_id or ""
    sid = subtopic_id or ""
    scoped = bool(uid or tid or sid)

    if not scoped:
        bind = {"1": {"type": "TEXT", "value": emb_str}, "2": {"type": "TEXT", "value": course_id}}
        sql = f"""
        SELECT * FROM (
            SELECT chunk_id, document_id, course_id, module_id, text,
                   COALESCE(document_title, '') AS document_title,
                   COALESCE(course_name, '') AS course_name,
                   COALESCE(module_name, '') AS module_name,
                   VECTOR_COSINE_SIMILARITY(embedding, PARSE_JSON(?)::VECTOR(FLOAT, 768)) AS score
            FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks
            WHERE course_id = ?
        ) WHERE score >= {similarity_threshold}
        ORDER BY score DESC
        LIMIT {top_k}
        """
    else:
        bind = {
            "1": {"type": "TEXT", "value": emb_str},
            "2": {"type": "TEXT", "value": course_id},
            "3": {"type": "TEXT", "value": uid},
            "4": {"type": "TEXT", "value": uid},
            "5": {"type": "TEXT", "value": tid},
            "6": {"type": "TEXT", "value": tid},
            "7": {"type": "TEXT", "value": sid},
            "8": {"type": "TEXT", "value": sid},
        }
        sql = f"""
        SELECT * FROM (
            SELECT d.chunk_id, d.document_id, d.course_id, d.module_id, d.text,
                   COALESCE(d.document_title, '') AS document_title,
                   COALESCE(d.course_name, '') AS course_name,
                   COALESCE(d.module_name, '') AS module_name,
                   VECTOR_COSINE_SIMILARITY(d.embedding, PARSE_JSON(?)::VECTOR(FLOAT, 768)) AS score
            FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.document_chunks d
            WHERE d.course_id = ?
              AND d.chunk_id IN (
                SELECT a.chunk_id FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.chunk_assignments a
                WHERE (? = '' OR a.unit_id = ?)
                  AND (? = '' OR a.topic_id = ?)
                  AND (? = '' OR a.subtopic_id = ?)
              )
        ) WHERE score >= {similarity_threshold}
        ORDER BY score DESC
        LIMIT {top_k}
        """
    data = _execute_and_fetch(sql, bind)
    columns = ["chunk_id", "document_id", "course_id", "module_id", "text", "document_title", "course_name", "module_name", "score"]
    return [_row_to_dict(columns, row) for row in data]


def _row_to_dict(columns: list[str], row: list[Any]) -> dict[str, Any]:
    return dict(zip(columns, row)) if len(row) >= len(columns) else {}


def _execute_and_fetch(statement: str, bindings: dict | None = None) -> list[list[Any]]:
    """Submit statement and return result rows (poll if async)."""
    resp = requests.post(
        ENDPOINT,
        headers=_headers(),
        json=_body(statement, bindings, timeout=60),
    )
    raw = resp.text
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {}
    if not resp.ok:
        raise RuntimeError(f"Snowflake error ({resp.status_code}): {raw}")

    # Inline result
    if data.get("data") is not None:
        return data["data"]
    handle = data.get("statementHandle")
    if not handle:
        return []

    # Poll for result
    for _ in range(60):
        time.sleep(0.5)
        r2 = requests.get(f"{ENDPOINT}/{handle}", headers=_headers())
        r2.raise_for_status()
        d = r2.json()
        if d.get("status") == "SUCCESS" and "data" in d:
            return d.get("data", [])
        if d.get("status") in ("FAILED", "ABORTED"):
            raise RuntimeError(d.get("message", str(d)))
    return []
