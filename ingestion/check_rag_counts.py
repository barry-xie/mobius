"""
Quick check: query Snowflake RAG schema for row counts.
Run from ingestion dir: python check_rag_counts.py
"""
from __future__ import annotations

import time
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

ENDPOINT = f"https://{SNOWFLAKE_HOST}/api/v2/statements"


def _headers():
    h = {
        "Authorization": f"Bearer {SNOWFLAKE_TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if SNOWFLAKE_TOKEN_TYPE:
        h["X-Snowflake-Authorization-Token-Type"] = SNOWFLAKE_TOKEN_TYPE
    return h


def run_and_fetch(statement: str) -> list[list[Any]]:
    """Submit statement and poll for result rows."""
    body = {
        "statement": statement,
        "timeout": 60,
        "warehouse": SNOWFLAKE_WAREHOUSE,
        "database": SNOWFLAKE_DATABASE,
        "schema": SNOWFLAKE_RAG_SCHEMA,
    }
    if SNOWFLAKE_ROLE:
        body["role"] = SNOWFLAKE_ROLE
    r = requests.post(ENDPOINT, headers=_headers(), json=body)
    r.raise_for_status()
    data = r.json()
    handle = data.get("statementHandle")
    if not handle:
        # Result might be inline
        if data.get("resultSetMetaData") and data.get("data"):
            return data.get("data", [])
        return []
    # Poll for result
    for _ in range(30):
        time.sleep(0.5)
        r2 = requests.get(f"{ENDPOINT}/{handle}", headers=_headers())
        r2.raise_for_status()
        d = r2.json()
        if d.get("status") == "SUCCESS" and "resultSetMetaData" in d:
            return d.get("data", [])
    return []


def main():
    tables = ["courses", "modules", "documents", "document_chunks"]
    print(f"Database: {SNOWFLAKE_DATABASE}, Schema: {SNOWFLAKE_RAG_SCHEMA}\n")
    for t in tables:
        q = f"SELECT COUNT(*) FROM {SNOWFLAKE_DATABASE}.{SNOWFLAKE_RAG_SCHEMA}.{t}"
        rows = run_and_fetch(q)
        count = rows[0][0] if rows else "?"
        print(f"  {t}: {count}")


if __name__ == "__main__":
    main()
