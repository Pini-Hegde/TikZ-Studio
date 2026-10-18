import os

os.environ.update(SUPABASE_URL="https://fake.supabase.co", SUPABASE_KEY="sb_publishable_test", COOKIE_SECURE="false")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402
from utils import config, security, supabase  # noqa: E402
from utils.auth import current_user  # noqa: E402
from utils.security import rate_limited, safe_relative_path  # noqa: E402

client = TestClient(app)
MAIN = {"name": "Main.tex", "content": "\\documentclass{article}"}
PROJECT_ID = "6f1c2a52-6d0e-4c1b-9a51-6a3f0f6e2b10"
SESSION = {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600, "user": {"id": "u1", "email": "a@b.co"}}


@pytest.fixture(autouse=True)
def fresh_state(monkeypatch):
    """Reset rate limits and cookies; replace Supabase with a scriptable fake."""
    security._hits.clear()
    client.cookies.clear()
    app.dependency_overrides.clear()
    calls = []
    replies = {}

    def fake_call(method, path, **kwargs):
        calls.append((method, path, kwargs))
        for prefix, reply in replies.items():
            if path.startswith(prefix):
                return reply
        return 200, None

    monkeypatch.setattr(supabase, "call", fake_call)
    return calls, replies


def signed_in():
    app.dependency_overrides[current_user] = lambda: {"id": "u1", "email": "a@b.co"}
    client.cookies.set("tikz_access", "acc")


def compile_(files, main="Main.tex"):
    return client.post("/api/v1/compile", json={"mainFileName": main, "files": files})


def test_safe_relative_path():
    assert safe_relative_path("figures/diagram.tex") == "figures/diagram.tex"
    for bad in ["../../etc/passwd", "/etc/passwd", "C:\\Windows\\system.ini", "a/../..", "x\0.tex"]:
        with pytest.raises(ValueError):
            safe_relative_path(bad)


def test_compile_requires_sign_in():
    assert compile_([MAIN]).json()["error"]["code"] == "UNAUTHENTICATED"


def test_compile_validation_errors():
    signed_in()
    r = compile_([{**MAIN, "name": "other.tex"}])
    assert r.status_code == 400
    assert "present in files" in r.json()["error"]["details"][0]["message"]
    assert compile_([MAIN, {**MAIN, "name": "../x.tex"}]).status_code == 400
    assert compile_([MAIN, MAIN]).status_code == 400
    assert compile_([MAIN], main="Main.txt").status_code == 400
    # 503 when pdflatex isn't installed locally; in Docker the doc lacks \begin{document} -> 422.
    assert compile_([MAIN]).status_code in (422, 503)


def test_login_sets_httponly_cookies(fresh_state):
    _, replies = fresh_state
    replies["/auth/v1/token"] = (200, SESSION)
    r = client.post("/api/v1/auth/login", json={"email": "a@b.co", "password": "password123"})
    assert r.status_code == 200 and r.json()["user"]["email"] == "a@b.co"
    cookies = r.headers.get_list("set-cookie")
    assert any(c.startswith("tikz_access=acc") and "HttpOnly" in c and "Path=/api" in c for c in cookies)
    assert any(c.startswith("tikz_refresh=ref") and "Path=/api/v1/auth" in c for c in cookies)
    assert "acc" not in r.text  # tokens never reach page JavaScript


def test_login_failure_and_weak_password(fresh_state):
    _, replies = fresh_state
    replies["/auth/v1/token"] = (400, {"msg": "Invalid login credentials"})
    r = client.post("/api/v1/auth/login", json={"email": "a@b.co", "password": "password123"})
    assert r.status_code == 401 and r.json()["error"]["message"] == "Invalid login credentials"
    assert client.post("/api/v1/auth/signup", json={"email": "a@b.co", "password": "short"}).status_code == 400


def test_failed_refresh_clears_cookies(fresh_state):
    _, replies = fresh_state
    replies["/auth/v1/token"] = (400, {"msg": "Invalid Refresh Token"})
    client.cookies.set("tikz_refresh", "old")
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 401
    assert any(c.startswith("tikz_refresh=") and "Max-Age=0" in c for c in r.headers.get_list("set-cookie"))


def test_projects_require_sign_in():
    assert client.get("/api/v1/projects").status_code == 401


def test_list_and_save_projects(fresh_state):
    calls, replies = fresh_state
    client.cookies.set("tikz_access", "acc")
    replies["/rest/v1/projects?select"] = (200, [{"id": PROJECT_ID, "title": "T", "tags": [], "is_archived": False, "engine": "xelatex", "files": [], "updated_at": "2026-10-10T00:00:00Z"}])
    listed = client.get("/api/v1/projects").json()["projects"][0]
    assert listed["isArchived"] is False and listed["engine"] == "xelatex"

    body = {"title": "T", "tags": ["a"], "isArchived": True, "files": [{"id": "f", "name": "Main.tex", "content": "x"}]}
    assert client.put(f"/api/v1/projects/{PROJECT_ID}", json=body).status_code == 204
    method, path, kwargs = calls[-1]
    assert (method, path) == ("POST", "/rest/v1/projects?on_conflict=id")
    assert kwargs["token"] == "acc" and kwargs["body"]["is_archived"] is True and "user_id" not in kwargs["body"]
    assert kwargs["body"]["engine"] == "pdflatex"  # default when the client doesn't pick one

    # The engine is saved with the project; only engines the compiler runs are accepted.
    assert client.put(f"/api/v1/projects/{PROJECT_ID}", json={**body, "engine": "lualatex"}).status_code == 204
    assert calls[-1][2]["body"]["engine"] == "lualatex"
    assert client.put(f"/api/v1/projects/{PROJECT_ID}", json={**body, "engine": "tex"}).status_code == 400

    assert client.put("/api/v1/projects/not-a-uuid", json=body).status_code == 400
    assert client.put(f"/api/v1/projects/{PROJECT_ID}", json={**body, "user_id": "someone"}).status_code == 400
    assert client.delete(f"/api/v1/projects/{PROJECT_ID}").status_code == 204  # no body, no Content-Length


def test_database_errors_map_to_api_errors(fresh_state):
    _, replies = fresh_state
    client.cookies.set("tikz_access", "expired")
    replies["/rest/v1/projects"] = (401, {"message": "JWT expired"})
    assert client.get("/api/v1/projects").status_code == 401
    replies["/rest/v1/projects"] = (403, {"code": "42501"})
    assert client.put(f"/api/v1/projects/{PROJECT_ID}", json={"title": "T"}).status_code == 403


def test_cross_site_writes_are_rejected():
    r = client.post("/api/v1/auth/logout", headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.post("/api/v1/auth/logout", headers={"Origin": "http://localhost:3000"}).status_code == 204


def test_request_id_and_security_headers():
    r = client.get("/health", headers={"X-Request-Id": "bad id\r\nx"})
    assert r.headers["x-request-id"] != "bad id\r\nx"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert client.get("/health", headers={"X-Request-Id": "abc-123"}).headers["x-request-id"] == "abc-123"


def test_error_shape_for_unknown_and_unbuilt_routes():
    assert client.get("/nope").json()["error"]["code"] == "NOT_FOUND"
    assert client.post("/api/v1/generate", json={}).status_code == 401  # sign-in checked first


def test_body_size_limit():
    r = client.post("/api/v1/compile", content=b"x", headers={"Content-Length": str(10**9), "Content-Type": "application/json"})
    assert r.status_code == 413


def test_rate_limit_buckets():
    login = "/api/v1/auth/login"
    results = [rate_limited("203.0.113.9", login, 1000.0) for _ in range(config.AUTH_RATE_LIMIT_PER_MINUTE + 1)]
    assert results[-1] and not any(results[:-1])
    assert not rate_limited("203.0.113.9", "/api/v1/projects", 1000.0)  # separate bucket
    assert not rate_limited("203.0.113.9", "/api/v1/auth/logout", 1000.0)  # logout never locked out
    assert not rate_limited("203.0.113.9", login, 1061.0)  # window expired


def test_signup_confirmation_uses_pkce(fresh_state):
    import base64, hashlib  # noqa: E401
    calls, replies = fresh_state
    replies["/auth/v1/signup"] = (200, {"id": "u1", "email": "a@b.co"})  # confirmation required: no session yet
    r = client.post("/api/v1/auth/signup", json={"email": "a@b.co", "password": "password123"})
    assert r.json() == {"user": None, "confirmEmail": True}
    _, path, kwargs = calls[-1]
    assert "redirect_to=http%3A%2F%2Ftestserver%2Fapi%2Fv1%2Fauth%2Fcallback" in path
    verifier = client.cookies.get("tikz_pkce")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert kwargs["body"]["code_challenge"] == challenge and kwargs["body"]["code_challenge_method"] == "s256"

    replies["/auth/v1/token"] = (200, SESSION)
    r = client.get("/api/v1/auth/callback?code=abc", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "http://localhost:3000/"  # no tokens in the URL
    assert calls[-1][2]["body"] == {"auth_code": "abc", "code_verifier": verifier}
    cookies = r.headers.get_list("set-cookie")
    assert any(c.startswith("tikz_access=acc") for c in cookies)
    assert any(c.startswith("tikz_pkce=") and "Max-Age=0" in c for c in cookies)

    client.cookies.clear()  # link opened in another browser: no verifier
    r = client.get("/api/v1/auth/callback?code=abc", follow_redirects=False)
    assert r.headers["location"].startswith("http://localhost:3000/?auth_error=")


def test_generate(monkeypatch):
    import io
    import json

    from utils import model

    signed_in()
    monkeypatch.setattr(config, "GROQ_API_KEY", "")
    assert client.post("/api/v1/generate", json={"instruction": "a table"}).status_code == 503

    monkeypatch.setattr(config, "GROQ_API_KEY", "gsk_test")
    reply = {"choices": [{"message": {"content": "```latex\n\\begin{tabular}{cc}\n\\end{tabular}\n```"}}]}
    monkeypatch.setattr(model.urllib.request, "urlopen", lambda *a, **k: io.BytesIO(json.dumps(reply).encode()))
    r = client.post("/api/v1/generate", json={"instruction": "a table", "preamble": "\\documentclass{article}"})
    assert r.json() == {"code": "\\begin{tabular}{cc}\n\\end{tabular}"}
    assert client.post("/api/v1/generate", json={"instruction": "x" * 501}).status_code == 400


def test_generate_tikz(monkeypatch):
    import io
    import json
    import urllib.error

    from utils import model

    signed_in()
    monkeypatch.setattr(config, "TIKZ_MODEL_URL", "")
    assert client.post("/api/v1/generate/tikz", json={"prompt": "a neuron"}).status_code == 503

    monkeypatch.setattr(config, "TIKZ_MODEL_URL", "http://model:8000/v1/chat/completions")
    monkeypatch.setattr(config, "TIKZ_VARIANTS", 3)
    replies = iter(["```latex\n\\documentclass[tikz]{standalone}\n```", None, "\\documentclass{standalone}"])

    def fake_urlopen(*a, **k):
        reply = next(replies)
        if reply is None:  # one variant fails; the others still come back
            raise urllib.error.URLError("down")
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": reply}}]}).encode())

    monkeypatch.setattr(model.urllib.request, "urlopen", fake_urlopen)
    r = client.post("/api/v1/generate/tikz", json={"prompt": "a neuron"})
    assert sorted(r.json()["variants"]) == ["\\documentclass[tikz]{standalone}", "\\documentclass{standalone}"]

    monkeypatch.setattr(model.urllib.request, "urlopen", lambda *a, **k: (_ for _ in ()).throw(urllib.error.URLError("down")))
    assert client.post("/api/v1/generate/tikz", json={"prompt": "a neuron"}).status_code == 502
    assert client.post("/api/v1/generate/tikz", json={"prompt": ""}).status_code == 400

    sent = []

    def fake_revision(request, **k):
        sent.append(json.loads(request.data)["messages"])
        return io.BytesIO(json.dumps({"choices": [{"message": {"content": "\\begin{tikzpicture}B\\end{tikzpicture}"}}]}).encode())

    monkeypatch.setattr(model.urllib.request, "urlopen", fake_revision)
    revision = {"prompt": "a neuron", "code": "\\begin{tikzpicture}A\\end{tikzpicture}", "change": "thicker lines"}
    r = client.post("/api/v1/generate/tikz", json=revision)
    assert r.json() == {"variants": ["\\begin{tikzpicture}B\\end{tikzpicture}"]}
    assert len(sent) == 1 and sent[0][-2]["content"] == revision["code"] and "thicker lines" in sent[0][-1]["content"]
    assert client.post("/api/v1/generate/tikz", json={"prompt": "a neuron", "change": "thicker"}).status_code == 400


def test_compile_png(monkeypatch):
    from services import compiler as service

    signed_in()

    engines = []

    def fake_latexmk(project_dir, tex_home, main, engine):
        engines.append(engine)
        (project_dir / "Main.pdf").write_bytes(b"%PDF-1.5 fake")
        return 0

    def fake_png(project_dir, pdf_path):
        assert pdf_path.name == "Main.pdf"
        (project_dir / "preview.png").write_bytes(b"\x89PNG fake")
        return project_dir / "preview.png"

    monkeypatch.setattr(service, "_latexmk", fake_latexmk)
    monkeypatch.setattr(service, "_png", fake_png)
    r = client.post("/api/v1/compile?format=png", json={"mainFileName": "Main.tex", "files": [MAIN]})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == b"\x89PNG fake"
    assert 'filename="Main.png"' in r.headers["content-disposition"]

    r = compile_([MAIN])  # default stays a PDF
    assert r.headers["content-type"] == "application/pdf" and r.content == b"%PDF-1.5 fake"
    assert client.post("/api/v1/compile?format=svg", json={"mainFileName": "Main.tex", "files": [MAIN]}).status_code == 400

    # Engine: pdflatex unless the request picks xelatex or lualatex; anything else is rejected.
    for engine in ("xelatex", "lualatex"):
        assert client.post("/api/v1/compile", json={"mainFileName": "Main.tex", "engine": engine, "files": [MAIN]}).status_code == 200
    assert engines == ["pdflatex", "pdflatex", "xelatex", "lualatex"]
    assert client.post("/api/v1/compile", json={"mainFileName": "Main.tex", "engine": "tex", "files": [MAIN]}).status_code == 400


def test_engines_endpoint():
    from schemas.compiler import ENGINES
    from services import compiler as service

    assert client.get("/api/v1/compile/engines").json() == {"engines": ["pdflatex", "xelatex", "lualatex"], "default": "pdflatex"}
    assert set(service._ENGINE_FLAGS) == set(ENGINES)  # the compiler knows how to run every listed engine


CHAT_ID = "9a1c2a52-6d0e-4c1b-9a51-6a3f0f6e2b11"


def test_figure_chats(fresh_state):
    calls, replies = fresh_state
    signed_in()

    replies["/rest/v1/figure_chats?select"] = (200, [{"id": CHAT_ID, "title": "Neural net", "project_id": None, "updated_at": "2026-10-17T00:00:00Z"}])
    assert client.get("/api/v1/figure-chats").json() == {"chats": [{"id": CHAT_ID, "title": "Neural net", "projectId": None, "updatedAt": "2026-10-17T00:00:00Z"}]}

    body = {"title": "Neural net", "projectId": PROJECT_ID, "turns": [{"request": "a net", "prompt": "a net", "variants": [{"code": "\\begin{tikzpicture}\\end{tikzpicture}"}], "active": 0}], "refining": {"turn": 0, "variant": 0}}
    replies["/rest/v1/figure_chats?on_conflict"] = (201, None)
    assert client.put(f"/api/v1/figure-chats/{CHAT_ID}", json=body).status_code == 204
    method, path, kwargs = calls[-1]
    assert (method, path) == ("POST", "/rest/v1/figure_chats?on_conflict=id")
    assert kwargs["body"]["project_id"] == PROJECT_ID and kwargs["body"]["turns"][0]["isRevision"] is False

    # The project isn't saved yet: the chat still saves, without the link.
    attempts = []
    def flaky(method, path, **kwargs):
        attempts.append(kwargs["body"]["project_id"])
        return (409, {"code": "23503"}) if kwargs["body"]["project_id"] else (201, None)
    supabase_call = supabase.call
    supabase.call = flaky
    try:
        assert client.put(f"/api/v1/figure-chats/{CHAT_ID}", json=body).status_code == 204
    finally:
        supabase.call = supabase_call
    assert attempts == [PROJECT_ID, None]

    assert client.put(f"/api/v1/figure-chats/{CHAT_ID}", json={**body, "user_id": "someone"}).status_code == 400
    assert client.put(f"/api/v1/figure-chats/{CHAT_ID}", json={**body, "title": ""}).status_code == 400
    assert client.put("/api/v1/figure-chats/not-a-uuid", json=body).status_code == 400

    replies["/rest/v1/figure_chats?id=eq"] = (200, [])
    assert client.get(f"/api/v1/figure-chats/{CHAT_ID}").status_code == 404
    assert client.delete(f"/api/v1/figure-chats/{CHAT_ID}").status_code == 204

    # Table not created yet: a clear message instead of a generic database error.
    replies.clear()
    replies["/rest/v1/figure_chats"] = (404, {"code": "PGRST205", "message": "Could not find the table"})
    r = client.get("/api/v1/figure-chats")
    assert r.status_code == 503 and r.json()["error"]["code"] == "HISTORY_NOT_SET_UP"


def test_figure_chats_need_sign_in_and_the_table():
    assert client.get("/api/v1/figure-chats").status_code == 401

