"""PIN hashing, PIN generation, and JWT session token helpers."""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta

import bcrypt
import jwt

log = logging.getLogger(__name__)

# A dev fallback is acceptable for local work but catastrophic in prod.
# We log loudly every time we fall through to it so forgetting to set
# SESSION_JWT_SECRET in Cloud Run is loud, not silent.
_DEV_FALLBACK = secrets.token_urlsafe(32)
_ENV_SECRET = os.environ.get("SESSION_JWT_SECRET")
if not _ENV_SECRET:
    log.warning(
        "SESSION_JWT_SECRET not set — using dev fallback. "
        "DO NOT RUN THIS IN PRODUCTION WITHOUT SETTING IT."
    )
SESSION_JWT_SECRET = _ENV_SECRET or _DEV_FALLBACK
SESSION_JWT_ALGORITHM = "HS256"
SESSION_TOKEN_TTL_DAYS = 30

USERNAME_REGEX = r"^[A-Za-z0-9_]{2,24}$"
PIN_REGEX = r"^\d{6}$"


def generate_pin() -> str:
    """6-digit PIN with a cryptographically-strong random source."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_pin(pin: str, stored_hash: str) -> bool:
    if not pin or not stored_hash:
        return False
    try:
        return bcrypt.checkpw(pin.encode(), stored_hash.encode())
    except ValueError:
        return False


def issue_session_token(username: str) -> tuple[str, datetime]:
    exp = datetime.utcnow() + timedelta(days=SESSION_TOKEN_TTL_DAYS)
    token = jwt.encode(
        {"sub": username, "exp": exp, "iat": datetime.utcnow()},
        SESSION_JWT_SECRET,
        SESSION_JWT_ALGORITHM,
    )
    return token, exp


def verify_session_token(token: str) -> str | None:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, SESSION_JWT_SECRET, algorithms=[SESSION_JWT_ALGORITHM]
        )
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
