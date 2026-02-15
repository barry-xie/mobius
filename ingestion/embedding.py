"""
Gemini embedding via google-genai (non-deprecated): one model for documents and queries, 768 dims for Snowflake.
"""
from __future__ import annotations

from typing import Any

from google import genai
from google.genai import types

from config import (
    EMBED_BATCH_SIZE,
    GEMINI_EMBEDDING_DIM,
    GEMINI_EMBEDDING_MODEL,
    GEMINI_API_KEY,
)

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


def _parse_embedding(item: Any) -> list[float]:
    """Turn one response.embeddings[i] into list[float]."""
    emb = list(getattr(item, "values", item) if not isinstance(item, (list, tuple)) else item)
    if len(emb) > GEMINI_EMBEDDING_DIM:
        emb = emb[:GEMINI_EMBEDDING_DIM]
    return emb


def embed_texts_batch(texts: list[str]) -> list[list[float]]:
    """
    Embed multiple texts in batches (fewer API calls). Uses Gemini multi-content
    embed_content; on batch failure, falls back to per-text embed_text for that batch.
    """
    if not texts:
        return []
    client = _client_get()
    config = types.EmbedContentConfig(output_dimensionality=GEMINI_EMBEDDING_DIM)
    result: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[start : start + EMBED_BATCH_SIZE]
        normalized = [(t.strip() or " ") for t in batch]
        try:
            response = client.models.embed_content(
                model=GEMINI_EMBEDDING_MODEL,
                contents=normalized,
                config=config,
            )
            if not response.embeddings or len(response.embeddings) != len(batch):
                raise RuntimeError(
                    f"Unexpected embeddings count: got {len(response.embeddings or [])}, expected {len(batch)}"
                )
            for item in response.embeddings:
                result.append(_parse_embedding(item))
        except Exception:
            # Fallback: one API call per text in this batch
            for t in batch:
                result.append(embed_text(t))
    return result
