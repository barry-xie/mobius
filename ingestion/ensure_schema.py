"""
Create or update the RAG schema and all tables (including units, topics, subtopics, chunk_assignments).
Run from the ingestion directory. Safe to run multiple times.
Usage: python ensure_schema.py
"""
from __future__ import annotations

from snowflake_rag import ensure_rag_schema

if __name__ == "__main__":
    ensure_rag_schema()
    print("RAG schema and tables are ready.")
