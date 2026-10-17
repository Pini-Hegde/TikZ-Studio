from urllib.parse import quote

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from compiler.schemas import CompileRequest
from compiler.service import compile_project
from utils.auth import current_user

router = APIRouter(prefix="/api/v1")


# Plain `def`: FastAPI runs it in a worker thread so the blocking compile doesn't stall the server.
# Signed-in users only: compiling is the expensive endpoint, so it shouldn't be open to the internet.
@router.post("/compile", dependencies=[Depends(current_user)])
def compile_endpoint(project: CompileRequest):
    pdf_name, pdf = compile_project(project)
    ascii_name = "".join(c if c.isascii() and (c.isalnum() or c in "._-") else "_" for c in pdf_name)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(pdf_name)}"},
    )
