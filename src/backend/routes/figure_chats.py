"""Figure Studio history in Supabase, one list per user. Queries run with the user's own token, so row-level
security scopes every read and write to the caller's chats."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response

from schemas.figure_chats import ChatIn
from utils import supabase
from utils.auth import access_token
from utils.errors import AppError, log

router = APIRouter(prefix="/api/v1/figure-chats")


def _db(method: str, path: str, token: str, **kwargs):
    status, data = supabase.call(method, "/rest/v1/figure_chats" + path, token=token, **kwargs)
    if status == 401:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    if status == 403:
        raise AppError(403, "FORBIDDEN", "You don't have access to this chat.")
    if status == 404 and isinstance(data, dict) and data.get("code") == "PGRST205":
        raise AppError(503, "HISTORY_NOT_SET_UP", "Figure history isn't set up yet: run supabase/schema.sql in Supabase.")
    if status >= 400:
        log.warning("Supabase error %s: %s", status, data)
        raise AppError(502, "DATABASE_ERROR", "The figure history could not be saved or loaded.")
    return status, data


@router.get("")
def list_chats(token: str = Depends(access_token)):
    """Summaries only; the conversation itself loads when a chat is opened."""
    _, rows = _db("GET", "?select=id,title,project_id,updated_at&order=updated_at.desc&limit=200", token)
    return {"chats": [{"id": r["id"], "title": r["title"], "projectId": r["project_id"], "updatedAt": r["updated_at"]} for r in rows]}


@router.get("/{chat_id}")
def get_chat(chat_id: UUID, token: str = Depends(access_token)):
    _, rows = _db("GET", f"?id=eq.{chat_id}&select=id,title,project_id,turns,refining,updated_at", token)
    if not rows:
        raise AppError(404, "NOT_FOUND", "That chat no longer exists.")
    r = rows[0]
    return {"id": r["id"], "title": r["title"], "projectId": r["project_id"], "turns": r["turns"], "refining": r["refining"], "updatedAt": r["updated_at"]}


@router.put("/{chat_id}", status_code=204)
def save_chat(chat_id: UUID, chat: ChatIn, token: str = Depends(access_token)):
    """Create or replace. The client picks the UUID, so a new chat saves without an id round trip."""
    body = {
        "id": str(chat_id),
        "title": chat.title,
        "project_id": str(chat.projectId) if chat.projectId else None,
        "turns": [turn.model_dump() for turn in chat.turns],
        "refining": chat.refining.model_dump() if chat.refining else None,
    }
    headers = {"Prefer": "resolution=merge-duplicates,return=minimal"}
    try:
        _db("POST", "?on_conflict=id", token, body=body, headers=headers)
    except AppError as error:
        # A rejected project link (not saved yet, or deleted): keep the chat, drop the link.
        if error.code != "DATABASE_ERROR" or not body["project_id"]:
            raise
        _db("POST", "?on_conflict=id", token, body={**body, "project_id": None}, headers=headers)
    return Response(status_code=204)


@router.delete("/{chat_id}", status_code=204)
def delete_chat(chat_id: UUID, token: str = Depends(access_token)):
    _db("DELETE", f"?id=eq.{chat_id}", token, headers={"Prefer": "return=minimal"})
    return Response(status_code=204)
