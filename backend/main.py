"""App entry point: middleware, error handlers and feature routers. Features live in their own folders."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth.router import router as auth_router
from compiler.router import router as compiler_router
from generate.router import router as generate_router
from projects.router import router as projects_router
from utils import config
from utils.errors import install_error_handlers
from utils.security import guard

logging.basicConfig(level=logging.INFO)

# API docs are off so a public deployment doesn't advertise its surface.
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.middleware("http")(guard)
# Added after guard so it wraps it: CORS headers also land on guard's error responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,  # session cookies
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-Request-Id"],
    expose_headers=["Content-Disposition", "X-Request-Id"],
    max_age=600,
)
install_error_handlers(app)

for router in (auth_router, compiler_router, generate_router, projects_router):
    app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok"}
