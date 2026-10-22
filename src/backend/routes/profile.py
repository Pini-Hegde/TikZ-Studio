"""The signed-in user's profile (public.profiles). Queries run with the user's own token; row-level security
limits them to the caller's own row."""

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from utils import supabase
from utils.auth import access_token, current_user
from utils.errors import AppError, log

router = APIRouter(prefix="/api/v1/profile")


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    showTour: bool


def _db(method: str, path: str, token: str, **kwargs):
    status, data = supabase.call(method, "/rest/v1/profiles" + path, token=token, **kwargs)
    if status == 401:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    # Postgres / PostgREST for "no such column": the database predates show_tour.
    if status == 400 and isinstance(data, dict) and data.get("code") in ("42703", "PGRST204"):
        log.warning("profiles.show_tour is missing: run supabase/schema.sql in Supabase")
        raise AppError(503, "PROFILE_NOT_SET_UP", "The tour flag isn't set up yet: run supabase/schema.sql in Supabase.")
    if status >= 400:
        log.warning("Supabase error %s: %s", status, data)
        raise AppError(502, "DATABASE_ERROR", "The profile could not be loaded or saved.")
    return data


@router.get("")
def get_profile(token: str = Depends(access_token)):
    try:
        rows = _db("GET", "?select=display_name,show_tour&limit=1", token)
    except AppError as error:
        if error.code != "PROFILE_NOT_SET_UP":
            raise
        # No show_tour column yet: the name is still there, and with no flag stored the user hasn't toured.
        rows = _db("GET", "?select=display_name&limit=1", token)
    row = rows[0] if rows else {}
    return {"displayName": row.get("display_name"), "showTour": row.get("show_tour", True)}


@router.patch("", status_code=204)
def update_profile(body: ProfileUpdate, user: dict = Depends(current_user), token: str = Depends(access_token)):
    _db("PATCH", f"?id=eq.{user['id']}", token, body={"show_tour": body.showTour}, headers={"Prefer": "return=minimal"})
    return Response(status_code=204)
