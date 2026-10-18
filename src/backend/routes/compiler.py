from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from schemas.compiler import DEFAULT_ENGINE, ENGINES, CompileRequest
from services.compiler import compile_project
from utils.auth import current_user

router = APIRouter(prefix="/api/v1")


@router.get("/compile/engines")
def list_engines():
    return {"engines": list(ENGINES), "default": DEFAULT_ENGINE}


# Plain `def`: FastAPI runs it in a worker thread so the blocking compile doesn't stall the server.
# Signed-in users only: compiling is the expensive endpoint, so it shouldn't be open to the internet.
@router.post("/compile", dependencies=[Depends(current_user)])
# ?format=png returns page 1 as an image instead (figure previews).
def compile_endpoint(project: CompileRequest, format: Literal["pdf", "png"] = "pdf"):
    name, data = compile_project(project, png=format == "png")
    ascii_name = "".join(c if c.isascii() and (c.isalnum() or c in "._-") else "_" for c in name)
    return Response(
        data,
        media_type="image/png" if format == "png" else "application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"},
    )
