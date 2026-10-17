# TikZ Studio Architecture

## 1. Overview

TikZ Studio is split into two independent parts:

- A Next.js frontend for editing project files and displaying compiled PDFs.
- A Dockerized Python FastAPI backend that owns the complete LaTeX toolchain.

The browser never runs LaTeX and never creates a simulated compilation result. It sends the project source to the backend and displays the PDF return
ed by that backend.

# Flow demonstration

┌──────────────────────────────┐
│ Next.js frontend             │
│                              │
│ - LaTeX editor               │
│ - Project file management    │
│ - Recompile button           │
│ - PDF viewer and download    │
└──────────────┬───────────────┘
               │
               │ POST /api/v1/compile
               │ JSON project files
               ▼
┌──────────────────────────────┐
│ Dockerized FastAPI backend   │
│                              │
│ - Request validation         │
│ - Temporary workspace        │
│ - pdflatex compilation       │
│ - Resource limits            │
│ - Temporary-file cleanup     │
└──────────────┬───────────────┘
               │
               │ application/pdf
               ▼
┌──────────────────────────────┐
│ Frontend PDF viewer          │
└──────────────────────────────┘


## 2. Previous Architecture

The original implementation mixed frontend and backend responsibilities:

- The Next.js project contained an `/api/compile` server route.
- Node filesystem and child-process logic lived in the frontend repository structure.
- A platform-specific Linux Tectonic binary was committed under `.bin/`.
- The application depended on tools installed on the host computer.
- The frontend included a hardcoded SVG that could appear to be compiled output.
- Compiled PDFs and preview images were encoded inside JSON responses.

This made the compiler environment platform-dependent and blurred the boundary between the user interface and the compilation service.

## 3. Current Architecture

| Area | Current responsibility |
|---|---|
| Frontend | Editing, project management, API requests, PDF display and download |
| Backend | Validation, temporary files, LaTeX execution, error handling and PDF delivery |
| Docker | Python, TeX Live, TikZ packages and runtime isolation |
| API | Transfers source files to the backend and the generated PDF to the frontend |

Important changes:

- The frontend has no LaTeX compiler.
- The Next.js `/api/compile` route was removed.
- The committed compiler binary was removed.
- Compilation is handled by a dedicated Python FastAPI backend (`backend/main.py`).
- TeX Live and TikZ dependencies are installed in the backend image.
- Successful compilation returns raw PDF bytes instead of base64 JSON.
- The hardcoded diagram preview was removed.
- Compilation failures return structured JSON and a non-success HTTP status.

## 4. Compilation Flow

When the user presses **Recompile**, the following sequence occurs:

1. The frontend checks that the selected main file has a `.tex` extension.
2. The frontend collects the active project files, including `.tex` and `.bib` files.
3. It sends the files to `POST /api/v1/compile` as JSON.
4. The backend validates file names, paths, sizes, total project size and the selected main file.
5. The backend creates a unique temporary directory for the request.
6. Project files are written inside that directory.
7. `pdflatex` runs twice to resolve document structure and references.
8. The backend verifies that a PDF was produced and checks its size.
9. The PDF is loaded into memory.
10. The temporary directory and all compilation artifacts are deleted.
11. The backend returns the PDF with `Content-Type: application/pdf`.
12. The frontend creates a temporary browser object URL for the PDF.
13. The PDF is displayed in an iframe and can be downloaded.
14. The browser object URL is revoked when it is replaced or no longer required.

# Current piptline for compiling the LaTeX code

Editor files
    │
    ▼
JSON request
    │
    ▼
Validation ──invalid──▶ JSON error response
    │
   valid
    │
    ▼
Temporary directory
    │
    ▼
pdflatex pass 1
    │
    ▼
pdflatex pass 2
    │
    ▼
PDF size verification
    │
    ▼
Temporary-file cleanup
    │
    ▼
Raw PDF response
    │
    ▼
Browser PDF viewer



# 5. Validation and Safety

The backend applies several protections before and during compilation:

- The main file must exist in the submitted project.
- The main file must have a `.tex` extension.
- Absolute paths and directory traversal paths are rejected.
- Duplicate file names are rejected.
- File count, individual file size and total project size are limited.
- Generated PDF size is limited.
- The request body size is limited.
- LaTeX compilation has a timeout.
- LaTeX shell escape is disabled.
- API requests are rate limited.
- Browser origins are restricted using CORS.
- Temporary files are deleted in a `finally` block, including after failures.
- Only a limited number of compiles run at once (`MAX_CONCURRENT_COMPILES`); extra requests get `503 COMPILER_BUSY`.
- `pdflatex` runs with a minimal environment, so it never sees server secrets.
- TeX caches live outside the project folder, so uploaded files cannot overwrite them.
- The compile log is read from disk and trimmed, so a runaway document cannot exhaust memory.
- Client-supplied `X-Request-Id` values are accepted only if they are short and alphanumeric.
- Security headers (`nosniff`, `no-store`, `frame-ancestors 'none'`, etc.) are sent on every response.
- API docs (`/docs`, `/openapi.json`) are disabled.
- Unexpected errors are logged server-side; clients only see a generic message.

## 6. Docker Isolation

The backend Docker image contains:

- Python 3.12
- The FastAPI application (served by uvicorn)
- TeX Live
- TikZ and common LaTeX packages
- Recommended LaTeX fonts

Docker Compose applies additional runtime restrictions:

- The container runs as a non-root user.
- Its main filesystem is read-only.
- Only `/tmp` is writable and it is memory-limited.
- Linux capabilities are dropped.
- Privilege escalation is disabled.
- CPU, memory and process counts are limited.
- A health check monitors the backend.

This makes compilation reproducible and prevents the frontend machine from requiring a local TeX installation.



## 7. Backend Layout

```
backend/
├── main.py            # app setup: middleware, error handlers, feature routers
├── utils/             # shared by every feature
│   ├── config.py      # all settings, read from environment variables
│   ├── errors.py      # AppError + the standard JSON error response
│   ├── security.py    # request guard (ids, CSRF origin check, body limit, rate limits, headers)
│   ├── supabase.py    # minimal Supabase REST client
│   ├── model.py       # chat call to any OpenAI-compatible model server (Groq or our own weights)
│   └── auth.py        # session cookies, access_token / current_user dependencies
├── auth/              # POST signup, login, refresh, logout; GET me   (/api/v1/auth/...)
├── compiler/          # POST /api/v1/compile (signed-in users only)
├── projects/          # GET /api/v1/projects, PUT/DELETE /api/v1/projects/{uuid}
├── generate/          # POST /api/v1/generate (`/! … !/` → LaTeX), POST /api/v1/generate/tikz (prompt → 10 TikZ variants)
└── tests/
```

Rule: code used by one feature stays in that feature's folder; code used by two or more features moves to `utils/`.
Features raise `AppError(status, code, message)` and never build error responses themselves.

## 8. Hosting Checklist

1. Put the backend behind a TLS reverse proxy (Caddy or nginx). Compose binds port 4000 to `127.0.0.1` only.
2. Set `CORS_ORIGINS` to the real frontend origin(s). `*` is rejected at startup.
3. Set `FORWARDED_ALLOW_IPS` to the proxy's IP so rate limiting sees real client IPs.
4. Keep a single uvicorn worker, or move rate limiting to the proxy/Redis before adding workers.
5. Set `NEXT_PUBLIC_BACKEND_URL` in the frontend to the public HTTPS backend URL.
6. Before building `projects/`: add user authentication and scope every query to the signed-in user.
7. Before building `generate/`: keep model API keys in environment variables only, and add per-user quotas.

## 9. Database (Supabase)

- Supabase Cloud provides Postgres and user accounts (email + password).
- The schema lives in `supabase/schema.sql`: one `projects` table (files stored as JSON) with row-level security,
  so each user can only read and write their own rows.
- The backend uses only the **publishable (anon) key** and forwards each user's own access token, so Postgres
  enforces ownership even if the backend has a bug. The service_role key is never used.
- Login tokens are stored in httpOnly, SameSite=Lax cookies; page JavaScript never sees them.
  The refresh token cookie is only sent to `/api/v1/auth/*`.
- The frontend autosaves one second after the last change; saves run one at a time, in order.

Setup:

1. Create a project at supabase.com.
2. SQL Editor -> paste `supabase/schema.sql` -> Run.
3. Authentication -> URL Configuration -> set Site URL to the frontend address, and add the backend callback (e.g. `http://localhost:4000/api/v1/auth/callback`) to Redirect URLs. Confirmation emails use PKCE: the link carries a one-time code that the backend swaps for a session using a verifier cookie, so tokens never appear in a URL. The link must be opened in the browser that signed up.
4. Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY`.
5. `docker compose up --build`.

Hosting notes:

- Serve frontend and API from the same site (e.g. `app.example.com` and `api.example.com`) so the SameSite
  cookies are sent; set `COOKIE_SECURE=true` behind HTTPS.
- All backend calls to Supabase come from one server IP, so Supabase's own per-IP auth limits apply to the
  whole app. The backend's per-client login limit (10/min) is the real brute-force protection.
