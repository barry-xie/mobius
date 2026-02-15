"""
Canvas API client: courses, modules, assignments, files, pages, syllabus.
Handles pagination and authenticated file download URLs.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlparse

import requests

from config import CANVAS_API_BASE, CANVAS_API_KEY


def _get(token: str, path: str, params: dict | None = None) -> Any:
    url = urljoin(CANVAS_API_BASE.rstrip("/") + "/", path.lstrip("/"))
    if params:
        # flatten array params like include[]=x
        q = []
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, (list, tuple)):
                for item in v:
                    q.append((k, str(item)))
            else:
                q.append((k, str(v)))
        # build URL with query (requests will handle encoding)
        from urllib.parse import urlencode
        url = url + "?" + urlencode(q)
    resp = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def _get_all_pages(token: str, path: str, params: dict | None = None) -> list[Any]:
    params = dict(params or {})
    params.setdefault("per_page", 100)
    page = 1
    out = []
    while True:
        params["page"] = page
        chunk = _get(token, path, params)
        if not isinstance(chunk, list) or not chunk:
            break
        out.extend(chunk)
        if len(chunk) < params["per_page"]:
            break
        page += 1
    return out


def _safe_get_all(token: str, path: str, params: dict | None = None) -> list[Any]:
    try:
        return _get_all_pages(token, path, params)
    except requests.HTTPError as e:
        if e.response and e.response.status_code in (401, 403, 404):
            return []
        raise


def fetch_courses(token: str | None = None) -> list[dict]:
    token = token or CANVAS_API_KEY
    if not token:
        raise ValueError("Canvas API key required (CANVAS_API)")
    raw = _get_all_pages(token, "/courses", {"state[]": ["available", "completed"]})
    if not raw:
        raw = _get_all_pages(token, "/courses")
    return [c for c in raw if c.get("workflow_state") in ("available", "completed", None)]


def fetch_modules(token: str, course_id: str | int) -> list[dict]:
    return _safe_get_all(token, f"/courses/{course_id}/modules", {"include[]": ["items"]})


def fetch_assignments(token: str, course_id: str | int) -> list[dict]:
    return _safe_get_all(token, f"/courses/{course_id}/assignments")


def fetch_files(token: str, course_id: str | int) -> list[dict]:
    return _safe_get_all(token, f"/courses/{course_id}/files")


def fetch_pages(token: str, course_id: str | int) -> list[dict]:
    return _safe_get_all(token, f"/courses/{course_id}/pages")


def fetch_page_body(token: str, course_id: str | int, page_url: str) -> str | None:
    """Get HTML body of a single page. page_url is the page's url slug (e.g. 'syllabus')."""
    try:
        # Canvas: GET /courses/:id/pages/:url
        data = _get(token, f"/courses/{course_id}/pages/{page_url}")
        return data.get("body") or None
    except requests.HTTPError:
        return None


def fetch_syllabus(token: str, course_id: str | int) -> str | None:
    try:
        data = _get(token, f"/courses/{course_id}", {"include[]": "syllabus_body"})
        return data.get("syllabus_body") or None
    except requests.HTTPError:
        return None


def download_file(token: str, url: str) -> bytes | None:
    """
    Download file from Canvas (or redirect). URL is from file['url'] and may require auth.
    Returns raw bytes or None on failure.
    """
    try:
        resp = requests.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            allow_redirects=True,
            timeout=120,
        )
        resp.raise_for_status()
        return resp.content
    except Exception:
        return None


def get_file_extension(filename: str) -> str:
    """Return lowercase extension without dot, e.g. 'pdf'."""
    if "." in filename:
        return filename.rsplit(".", 1)[-1].lower()
    return ""
