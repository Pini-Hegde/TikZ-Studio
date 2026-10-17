"""One error shape for every feature: {success, error: {code, message, ...}, requestId}."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

log = logging.getLogger("tikz_studio")


class AppError(Exception):
    """Raise from any feature; turned into the standard JSON error response."""

    def __init__(self, status: int, code: str, message: str, **extra):
        self.status, self.code, self.message, self.extra = status, code, message, extra


def error_response(request: Request, status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "success": False,
            "error": {"code": code, "message": message, **extra},
            "requestId": getattr(request.state, "request_id", None),
        },
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError):
        return error_response(request, exc.status, exc.code, exc.message, **exc.extra)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError):
        details = [
            {
                "path": ".".join(str(p) for p in e["loc"] if p != "body"),
                "message": e["msg"].removeprefix("Value error, "),
            }
            for e in exc.errors()
        ]
        return error_response(request, 400, "INVALID_REQUEST", "The request is invalid.", details=details)

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException):
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        return error_response(request, exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def internal_error(request: Request, exc: Exception):
        # Full traceback goes to server logs only; the client never sees internals.
        log.exception("Unhandled error (request %s)", getattr(request.state, "request_id", None))
        return error_response(request, 500, "INTERNAL_ERROR", "An unexpected error occurred.")
