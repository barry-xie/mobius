"""
Gemini embedding via google-genai (non-deprecated): one model for documents and queries, 768 dims for Snowflake.
"""
from __future__ import annotations

from google import genai
from google.genai import types

from config import GEMINI_EMBEDDING_DIM, GEMINI_EMBEDDING_MODEL, GEMINI_API_KEY

# Reused client (uses GEMINI_API_KEY or GOOGLE_API_KEY from env if not passed)
_client: genai.Client | None = None


def _client_get() -> genai.Client:
    global _client
    if _client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY required")
        _client = genai.Client(api_key=GEMINI_API_KEY)
    return _client


def embed_text(text: str) -> list[float]:
    """Return 768-dim embedding for a single string. Truncates if model returns more."""
    client = _client_get()
    response = client.models.embed_content(
        model=GEMINI_EMBEDDING_MODEL,
        contents=(text.strip() or " "),
        config=types.EmbedContentConfig(output_dimensionality=GEMINI_EMBEDDING_DIM),
    )
    # Response has .embeddings (list); single content -> embeddings[0], with .values or direct list
    if not response.embeddings:
        raise RuntimeError("No embeddings in response")
    first = response.embeddings[0]
    emb = list(getattr(first, "values", first) if not isinstance(first, (list, tuple)) else first)
    if len(emb) > GEMINI_EMBEDDING_DIM:
        emb = emb[:GEMINI_EMBEDDING_DIM]
    return emb


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple texts (sequential to respect rate limits)."""
    return [embed_text(t) for t in texts]
