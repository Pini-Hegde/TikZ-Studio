"""Session cookies and the dependencies features use to require a signed-in user."""

from fastapi import Request

from utils import supabase
from utils.errors import AppError

ACCESS_COOKIE = "tikz_access"
REFRESH_COOKIE = "tikz_refresh"


def access_token(request: Request) -> str:
    """Cheap check: the token is verified by Supabase on the next database call."""
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    return token


def public_user(user: dict) -> dict:
    """What the app sees of a Supabase user. The display name comes from public.profiles (GET /api/v1/profile)."""
    return {"id": user.get("id"), "email": user.get("email")}


def current_user(request: Request) -> dict:
    """Verified check, for endpoints that don't otherwise touch the database."""
    token = access_token(request)
    status, data = supabase.call("GET", "/auth/v1/user", token=token)
    if status != 200 or not isinstance(data, dict):
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    return public_user(data)
