"""Username + 6-digit PIN authentication routes."""
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.dependencies import require_current_username
from app.core.logging import get_logger
from app.core.rate_limit import limiter
from app.db.models import GameRow, LessonRow
from app.db.session import get_session
from app.db.user_models import UserRow
from app.services.auth import (
    PIN_REGEX,
    USERNAME_REGEX,
    generate_pin,
    hash_pin,
    issue_session_token,
    verify_pin,
)
from app.services.orchestrator import Orchestrator

log = get_logger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

_orch = Orchestrator()

AUTO_GAME_TYPES: tuple[str, ...] = (
    "lane_runner", "tetris_answer", "shooter_answer", "snake_knowledge",
)


class RegisterRequest(BaseModel):
    username: str
    lesson_id: str | None = None


class SignInRequest(BaseModel):
    username: str
    pin: str


def _attach_lesson(lesson_id: str, username: str, db: Session) -> None:
    """Claim an anonymous lesson for this new user AND propagate ownership
    onto any games already generated for it. Matches the behaviour of the
    standalone PATCH /api/lessons/{id}/claim endpoint so the two flows are
    interchangeable."""
    row = db.exec(
        select(LessonRow).where(LessonRow.lesson_id == lesson_id)
    ).first()
    if not row:
        raise HTTPException(404, "Lesson not found")
    if row.teacher_username not in ("", "anon") and row.teacher_username != username:
        raise HTTPException(403, "Lesson already claimed by another user.")
    if row.teacher_username != username:
        row.teacher_username = username
        db.add(row)

    existing_games = db.exec(
        select(GameRow).where(GameRow.lesson_id == lesson_id)
    ).all()
    existing_types: set[str] = set()
    for g in existing_games:
        if g.teacher_username != username:
            g.teacher_username = username
            db.add(g)
        existing_types.add((g.data or {}).get("game_type", ""))
    db.commit()

    for gt in AUTO_GAME_TYPES:
        if gt in existing_types:
            continue
        try:
            _orch.build_game(lesson_id, gt, db, teacher_username=username)
        except ValueError as e:
            log.error("auto_game_failed_on_register",
                      game_type=gt, error=str(e))


@router.post("/register", response_model=dict, status_code=201)
@limiter.limit("10/minute")
async def register(
    request: Request,
    body: RegisterRequest,
    db: Session = Depends(get_session),
):
    username = (body.username or "").strip()
    if not re.match(USERNAME_REGEX, username):
        raise HTTPException(
            400, "Invalid username (2-24 chars, letters, numbers, underscore).",
        )

    existing = db.exec(
        select(UserRow).where(UserRow.username == username)
    ).first()
    if existing:
        raise HTTPException(409, "Username already taken.")

    pin = generate_pin()
    db.add(UserRow(username=username, pin_hash=hash_pin(pin)))
    db.commit()
    log.info("user_registered", username=username)

    if body.lesson_id:
        _attach_lesson(body.lesson_id, username, db)

    token, exp = issue_session_token(username)
    return {
        "username": username,
        "pin": pin,
        "session_token": token,
        "expires_at": exp.isoformat() + "Z",
    }


@router.post("/signin", response_model=dict)
@limiter.limit("5/minute")
async def sign_in(
    request: Request,
    body: SignInRequest,
    db: Session = Depends(get_session),
):
    username = (body.username or "").strip()
    pin = (body.pin or "").strip()

    if not re.match(USERNAME_REGEX, username) or not re.match(PIN_REGEX, pin):
        # Same generic error as bad credentials so attackers can't distinguish
        # "malformed input" from "wrong creds" via timing or copy.
        raise HTTPException(401, "Invalid username or PIN.")

    row = db.exec(
        select(UserRow).where(UserRow.username == username)
    ).first()
    if not row or not verify_pin(pin, row.pin_hash):
        raise HTTPException(401, "Invalid username or PIN.")

    row.last_sign_in = datetime.utcnow()
    db.add(row)
    db.commit()
    log.info("user_signed_in", username=username)

    token, exp = issue_session_token(username)
    return {
        "username": username,
        "session_token": token,
        "expires_at": exp.isoformat() + "Z",
    }


@router.get("/me", response_model=dict)
async def get_me(
    username: str = Depends(require_current_username),
):
    return {"username": username}


@router.post("/signout", response_model=dict)
async def sign_out():
    # Stateless JWTs — server-side signout is a no-op. Client clears storage.
    return {"ok": True}
