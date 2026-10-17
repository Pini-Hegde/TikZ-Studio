"""Request guard (ids, body size, rate limit, headers) and path sanitising shared by all features."""

import posixpath
import re
import time
import uuid
from collections import deque

from fastapi import Request

from utils import config
from utils.errors import error_response

REQUEST_ID = re.compile(r"[A-Za-z0-9-]{1,64}")
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


def safe_relative_path(name: str) -> str:
    """Normalise a user-supplied file path, rejecting anything that could escape the project folder."""
    if "\0" in name:
        raise ValueError("File paths cannot contain null bytes.")
    portable = name.replace("\\", "/")
    if portable.startswith("/") or re.match(r"[a-zA-Z]:/", portable):
        raise ValueError("File paths must be relative.")
    normalized = posixpath.normpath(portable)
    if normalized in (".", "..") or normalized.startswith("../"):
        raise ValueError("File paths must stay inside the project.")
    return normalized


_hits: dict[tuple[str, str], deque] = {}


def _bucket(path: str) -> tuple[str, int]:
    # Strict limit only where passwords are guessed; logout/refresh must keep working after failed logins.
    if path in ("/api/v1/auth/login", "/api/v1/auth/signup"):
        return "auth", config.AUTH_RATE_LIMIT_PER_MINUTE
    if path.startswith("/api/v1/compile"):
        return "compile", config.RATE_LIMIT_PER_MINUTE
    if path.startswith("/api/v1/generate"):
        return "generate", config.GENERATE_RATE_LIMIT_PER_MINUTE
    return "api", config.API_RATE_LIMIT_PER_MINUTE


def rate_limited(ip: str, path: str, now: float) -> bool:
    if len(_hits) > 10_000:  # forget idle clients so the table can't grow forever
        for key in [k for k, w in _hits.items() if not w or now - w[-1] > 60]:
            del _hits[key]
    bucket, limit = _bucket(path)
    window = _hits.setdefault((ip, bucket), deque())
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= limit:
        return True
    window.append(now)
    return False


async def guard(request: Request, call_next):
    incoming = request.headers.get("x-request-id", "")
    request.state.request_id = incoming if REQUEST_ID.fullmatch(incoming) else str(uuid.uuid4())

    if request.url.path.startswith("/api/"):
        # CSRF: browsers always send Origin on cross-site writes; reject origins we don't serve.
        origin = request.headers.get("origin")
        if request.method != "GET" and origin and origin not in config.CORS_ORIGINS:
            return error_response(request, 403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed.")
        # Streamed bodies have no length to check up front, so refuse them.
        if "transfer-encoding" in request.headers:
            return error_response(request, 411, "LENGTH_REQUIRED", "Content-Length is required.")
        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > config.MAX_BODY_BYTES:
            return error_response(request, 413, "REQUEST_TOO_LARGE", "The request body is too large.")
        # Behind a proxy, request.client is the real client only if FORWARDED_ALLOW_IPS trusts that proxy.
        ip = request.client.host if request.client else "unknown"
        if rate_limited(ip, request.url.path, time.monotonic()):
            return error_response(request, 429, "RATE_LIMITED", "Too many requests. Try again shortly.")

    response = await call_next(request)
    response.headers["X-Request-Id"] = request.state.request_id
    response.headers.update(SECURITY_HEADERS)
    return response
