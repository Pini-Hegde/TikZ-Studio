"""Email + password accounts via Supabase Auth. Tokens live in httpOnly cookies, never in page JavaScript."""

import base64
import hashlib
import secrets
from typing import Annotated
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from utils import config, supabase
from utils.auth import ACCESS_COOKIE, REFRESH_COOKIE, current_user, public_user
from utils.errors import AppError, error_response

router = APIRouter(prefix="/api/v1/auth")

REFRESH_MAX_AGE = 30 * 24 * 3600
PKCE_COOKIE = "tikz_pkce"
PKCE_MAX_AGE = 24 * 3600  # Supabase email links expire after 24h by default


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+$")]
    password: Annotated[str, StringConstraints(min_length=8, max_length=72)]


class Signup(Credentials):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def _cookie_options() -> dict:
    return {"httponly": True, "secure": config.COOKIE_SECURE, "samesite": "lax"}


def _start_session(response: Response, session: dict) -> dict:
    response.set_cookie(ACCESS_COOKIE, session["access_token"], max_age=int(session.get("expires_in", 3600)), path="/api", **_cookie_options())
    # Refresh token is only ever sent to the auth routes.
    response.set_cookie(REFRESH_COOKIE, session["refresh_token"], max_age=REFRESH_MAX_AGE, path="/api/v1/auth", **_cookie_options())
    return public_user(session.get("user") or {})


def _end_session(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/api", **_cookie_options())
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth", **_cookie_options())


@router.post("/signup")
def signup(body: Signup, request: Request, response: Response):
    # PKCE: the confirmation link carries only a one-time code, useless without this browser's verifier cookie.
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    callback = quote(str(request.url_for("confirm_email")), safe="")
    status, data = supabase.call(
        "POST",
        f"/auth/v1/signup?redirect_to={callback}",
        body={
            "email": body.email,
            "password": body.password,
            # Only a carrier: there's no session yet to write the profile with, so the profiles trigger copies it
            # into profiles.display_name, which is what the app reads.
            "data": {"display_name": body.name},
            "code_challenge": challenge,
            "code_challenge_method": "s256",
        },
    )
    if status >= 400 or not isinstance(data, dict):
        raise AppError(400, "SIGNUP_FAILED", supabase.message(data, "Sign-up failed."))
    if data.get("access_token"):  # email confirmation disabled in Supabase
        return {"user": _start_session(response, data), "confirmEmail": False}
    # With confirmation on, Supabase hides an already-registered email: no error, just a user with no identities.
    if data.get("identities") == []:
        raise AppError(409, "EMAIL_TAKEN", "An account with this email already exists. Log in instead.")
    response.set_cookie(PKCE_COOKIE, verifier, max_age=PKCE_MAX_AGE, path="/api/v1/auth", **_cookie_options())
    return {"user": None, "confirmEmail": True}


@router.get("/callback", name="confirm_email")
def callback(request: Request, code: str = "", error_description: str = ""):
    """Supabase's confirmation link lands here; swap the code for a session and send the user to the app."""
    verifier = request.cookies.get(PKCE_COOKIE)
    session = None
    if code and verifier and not error_description:
        status, data = supabase.call("POST", "/auth/v1/token?grant_type=pkce", body={"auth_code": code, "code_verifier": verifier})
        session = data if status == 200 and isinstance(data, dict) else None

    app_url = config.CORS_ORIGINS[0] + "/"
    if session:
        response = RedirectResponse(app_url, status_code=303)
        _start_session(response, session)
    else:
        problem = error_description or "Couldn't sign you in from that link. If your email is confirmed, sign in below."
        response = RedirectResponse(app_url + "?" + urlencode({"auth_error": problem[:200]}), status_code=303)
    response.delete_cookie(PKCE_COOKIE, path="/api/v1/auth", **_cookie_options())
    return response


@router.post("/login")
def login(body: Credentials, response: Response):
    status, data = supabase.call("POST", "/auth/v1/token?grant_type=password", body=body.model_dump())
    if status != 200 or not isinstance(data, dict):
        # Supabase says "Invalid login credentials" for both unknown email and wrong password.
        raise AppError(401, "INVALID_CREDENTIALS", supabase.message(data, "Invalid email or password."))
    return {"user": _start_session(response, data)}


@router.post("/refresh")
def refresh(request: Request, response: Response):
    token = request.cookies.get(REFRESH_COOKIE)
    status, data = (0, None)
    if token:
        status, data = supabase.call("POST", "/auth/v1/token?grant_type=refresh_token", body={"refresh_token": token})
    if status != 200 or not isinstance(data, dict):
        # Returned, not raised: a raised error would drop the cookie-clearing headers.
        failed = error_response(request, 401, "UNAUTHENTICATED", "Your session has expired. Please sign in again.")
        _end_session(failed)
        return failed
    return {"user": _start_session(response, data)}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    token = request.cookies.get(ACCESS_COOKIE)
    if token:  # revoke this session's refresh token; ignore failures, cookies are cleared regardless
        try:
            supabase.call("POST", "/auth/v1/logout?scope=local", token=token)
        except AppError:
            pass
    _end_session(response)


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return {"user": user}
