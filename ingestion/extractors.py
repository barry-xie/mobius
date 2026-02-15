"""
Extract plain text from HTML (Canvas pages, assignment descriptions) and from binary files (PDF).
"""
from __future__ import annotations

import io
from html import unescape

from bs4 import BeautifulSoup
from pypdf import PdfReader


def html_to_text(html: str | None) -> str:
    """Strip tags and return plain text. Handles None and empty."""
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(html, "html.parser")
    # Remove script/style
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    return unescape(" ".join(chunk for chunk in chunks if chunk))


def pdf_to_text(data: bytes) -> str:
    """Extract text from PDF bytes. Skips bad pages; returns empty string if whole PDF fails."""
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages:
            try:
                t = page.extract_text()
                if t:
                    parts.append(t)
            except Exception:
                continue
        return "\n\n".join(parts)
    except Exception:
        return ""


def extract_text_from_file(data: bytes, filename: str) -> str:
    """
    Dispatch by extension. Supports PDF. Other types return empty (can add docx, etc. later).
    """
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext == "pdf":
        return pdf_to_text(data)
    # TODO: docx, txt, etc.
    return ""
