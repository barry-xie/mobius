"""Load config from environment. .env is gitignored."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from repo root (parent of ingestion/)
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

def get_env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


# Snowflake (RAG schema uses same DB, separate schema)
SNOWFLAKE_HOST = get_env("SNOWFLAKE_HOST")
SNOWFLAKE_TOKEN = get_env("SNOWFLAKE_TOKEN")
SNOWFLAKE_TOKEN_TYPE = get_env("SNOWFLAKE_TOKEN_TYPE", "PROGRAMMATIC_ACCESS_TOKEN")
SNOWFLAKE_DATABASE = get_env("SNOWFLAKE_DATABASE", "KNOT")
SNOWFLAKE_RAG_SCHEMA = "RAG"  # separate schema for RAG tables
SNOWFLAKE_WAREHOUSE = get_env("SNOWFLAKE_WAREHOUSE")
SNOWFLAKE_ROLE = get_env("SNOWFLAKE_ROLE")

# Canvas
CANVAS_API_KEY = get_env("CANVAS_API")
CANVAS_API_BASE = get_env("CANVAS_API_BASE", "https://canvas.instructure.com/api/v1")

# Gemini
GEMINI_API_KEY = get_env("GEMINI_API_KEY")

# Chunking (from design doc)
CHUNK_MIN_CHARS = 800
CHUNK_MAX_CHARS = 1200
CHUNK_OVERLAP_CHARS = 150

# Embedding (Gemini; 768 dims for Snowflake storage)
GEMINI_EMBEDDING_MODEL = "models/gemini-embedding-001"
GEMINI_EMBEDDING_DIM = 768

# Generation (practice questions)
GEMINI_GENERATION_MODEL = "gemini-2.0-flash"
RETRIEVAL_TOP_K = 8
RETRIEVAL_THRESHOLD = 0.25
RETRIEVAL_MIN_CHUNKS = 2
FAILURE_MESSAGE = "Not enough course material available to generate meaningful practice questions."
