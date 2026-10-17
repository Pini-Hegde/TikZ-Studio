"""Saved projects in Supabase. Queries run with the user's own token; row-level security scopes them."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response

from projects.schemas import ProjectIn
from utils import supabase
from utils.auth import access_token
from utils.errors import AppError, log

router = APIRouter(prefix="/api/v1/projects")

COLUMNS = "id,title,tags,is_archived,files,updated_at"


def _db(method: str, path: str, token: str, **kwargs):
    status, data = supabase.call(method, "/rest/v1/projects" + path, token=token, **kwargs)
    if status == 401:
        raise AppError(401, "UNAUTHENTICATED", "Please sign in.")
    if status == 403:  # row-level security refused: the row belongs to someone else
        raise AppError(403, "FORBIDDEN", "You don't have access to this project.")
    if status >= 400:
        log.warning("Supabase error %s: %s", status, data)
        raise AppError(502, "DATABASE_ERROR", "The project could not be saved or loaded.")
    return data


# Returns every project with its files; add a summary-only listing when projects get large.
@router.get("")
def list_projects(token: str = Depends(access_token)):
    rows = _db("GET", f"?select={COLUMNS}&order=updated_at.desc", token)
    return {
        "projects": [
            {
                "id": r["id"],
                "title": r["title"],
                "tags": r["tags"],
                "isArchived": r["is_archived"],
                "files": r["files"],
                "updatedAt": r["updated_at"],
            }
            for r in rows
        ]
    }


@router.put("/{project_id}", status_code=204)
def save_project(project_id: UUID, project: ProjectIn, token: str = Depends(access_token)):
    """Create or replace. The client picks the UUID, so offline-created projects need no id round trip."""
    _db(
        "POST",
        "?on_conflict=id",
        token,
        body={
            "id": str(project_id),
            "title": project.title,
            "tags": project.tags,
            "is_archived": project.isArchived,
            "files": [f.model_dump() for f in project.files],
        },
        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
    )
    return Response(status_code=204)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: UUID, token: str = Depends(access_token)):
    _db("DELETE", f"?id=eq.{project_id}", token, headers={"Prefer": "return=minimal"})
    return Response(status_code=204)
