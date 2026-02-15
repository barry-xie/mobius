"""
Paragraph-aware chunking: merge paragraphs to 800-1200 chars with 150-char overlap.
Chunks never span document boundaries (caller passes one document's text).
"""
from __future__ import annotations

from config import CHUNK_MAX_CHARS, CHUNK_MIN_CHARS, CHUNK_OVERLAP_CHARS


def _split_into_paragraphs(text: str) -> list[str]:
    """Split on double newline or single when we want to keep structure."""
    if not text or not text.strip():
        return []
    # Treat multiple newlines as paragraph boundary
    raw = text.split("\n\n")
    return [p.strip() for p in raw if p.strip()]


def chunk_text(text: str) -> list[str]:
    """
    Split document text into chunks of 800-1200 chars with 150-char overlap.
    Respects paragraph boundaries (does not break mid-paragraph).
    """
    if not text or not text.strip():
        return []
    paragraphs = _split_into_paragraphs(text)
    if not paragraphs:
        # No double newlines: treat whole as one block or split by single newlines
        paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    if not paragraphs:
        return [text.strip()] if text.strip() else []

    chunks = []
    current: list[str] = []
    current_len = 0
    overlap_buffer: list[str] = []  # paragraphs to carry into next chunk for overlap
    overlap_len = 0

    for p in paragraphs:
        p_len = len(p) + 2  # +2 for "\n\n"
        if current_len + p_len <= CHUNK_MAX_CHARS:
            current.append(p)
            current_len += p_len
            # Build overlap from the end: keep last paragraphs that fit in CHUNK_OVERLAP_CHARS
            overlap_buffer.append(p)
            overlap_len += p_len
            while overlap_len > CHUNK_OVERLAP_CHARS and len(overlap_buffer) > 1:
                removed = overlap_buffer.pop(0)
                overlap_len -= len(removed) + 2
        else:
            if current:
                chunk_text = "\n\n".join(current)
                if len(chunk_text) >= CHUNK_MIN_CHARS or not chunks:
                    chunks.append(chunk_text)
                # Start next chunk with overlap
                current = list(overlap_buffer)
                current_len = overlap_len
                overlap_buffer = list(overlap_buffer)
                overlap_len = sum(len(x) + 2 for x in overlap_buffer) if overlap_buffer else 0
            else:
                # Single paragraph longer than max: split by size
                start = 0
                while start < len(p):
                    end = min(start + CHUNK_MAX_CHARS, len(p))
                    chunk = p[start:end]
                    if len(chunk) >= CHUNK_MIN_CHARS or not chunks:
                        chunks.append(chunk)
                    start = end - CHUNK_OVERLAP_CHARS if end < len(p) else len(p)
                current = []
                current_len = 0
                overlap_buffer = []
                overlap_len = 0

    if current:
        chunk_text = "\n\n".join(current)
        if chunk_text and (len(chunk_text) >= CHUNK_MIN_CHARS or not chunks):
            chunks.append(chunk_text)

    return chunks
