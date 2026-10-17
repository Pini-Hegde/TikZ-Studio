"""Minimal Supabase REST client (Auth + PostgREST) on the standard library."""

import json
import urllib.error
import urllib.request

from utils import config
from utils.errors import AppError, log


def call(method: str, path: str, *, token: str | None = None, body=None, headers: dict | None = None):
    """Return (status, parsed JSON or None). Raises AppError only if Supabase is unreachable."""
    if not (config.SUPABASE_URL and config.SUPABASE_KEY):
        raise AppError(503, "DATABASE_NOT_CONFIGURED", "The database is not configured.")

    request = urllib.request.Request(
        config.SUPABASE_URL + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": config.SUPABASE_KEY, "Content-Type": "application/json", **(headers or {})},
    )
    if token:
        request.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read()
    except (urllib.error.URLError, TimeoutError) as e:
        log.warning("Supabase unreachable: %s", e)
        raise AppError(502, "DATABASE_UNAVAILABLE", "The database could not be reached.")

    try:
        return status, json.loads(raw) if raw else None
    except ValueError:
        return status, None


def message(data, fallback: str) -> str:
    """Pull the human-readable message out of a Supabase error body."""
    if isinstance(data, dict):
        return data.get("msg") or data.get("error_description") or data.get("message") or fallback
    return fallback
