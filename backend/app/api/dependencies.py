"""Request-scoped auth helpers.

`get_current_username` returns the session subject or None (optional auth).
`require_current_username` raises 401 if no valid session.
"""
from fastapi import HTTPException, Request

from app.services.auth import verify_session_token


def get_current_username(request: Request) -> str | None:
    token = request.headers.get("X-Session-Token")
    return verify_session_token(token) if token else None


def require_current_username(request: Request) -> str:
    user = get_current_username(request)
    if not user:
        raise HTTPException(401, "Sign in required")
    return user
