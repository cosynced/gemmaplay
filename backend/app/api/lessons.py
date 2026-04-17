"""Lesson upload + game retrieval endpoints."""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlmodel import Session, select

from app.core.logging import get_logger
from app.db.models import LessonRow
from app.db.session import get_session
from app.models.schemas import GAME_TYPES, Game, GameTypeId, Lesson
from app.services.orchestrator import Orchestrator

log = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["lessons"])
_orch = Orchestrator()

ALLOWED_SUFFIXES = {".pdf", ".txt", ".md"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


@router.post("/lessons", response_model=dict)
async def upload_lesson(
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
):
    """Upload a lesson file. Returns lesson metadata only — game generation
    happens separately via POST /api/games so the teacher can pick a type."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"Unsupported file type. Allowed: {ALLOWED_SUFFIXES}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (5 MB limit)")
    if not data:
        raise HTTPException(400, "Empty file")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        lesson = await _orch.ingest_lesson(tmp_path, db)
    except ValueError as e:
        log.error("ingest_failed", error=str(e))
        raise HTTPException(422, str(e)) from e
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "concepts": len(lesson.concepts),
    }


@router.get("/game-types", response_model=list[dict])
async def list_game_types():
    """Metadata for every game type the picker can offer."""
    return GAME_TYPES


class CreateGameRequest(BaseModel):
    lesson_id: str
    game_type: GameTypeId = "lane_runner"


@router.post("/games", response_model=dict)
async def create_game(
    body: CreateGameRequest,
    db: Session = Depends(get_session),
):
    """Build and persist a Game of the requested type for an existing lesson."""
    try:
        game = _orch.build_game(body.lesson_id, body.game_type, db)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return {
        "game_id": game.game_id,
        "game_type": game.game_type,
        "lesson_id": game.lesson_id,
    }


@router.get("/lessons", response_model=list[dict])
async def list_lessons(db: Session = Depends(get_session)):
    rows = db.exec(select(LessonRow).order_by(LessonRow.created_at.desc())).all()
    return [
        {
            "lesson_id": r.lesson_id,
            "title": r.title,
            "subject": r.subject,
            "grade_level": r.grade_level,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/lessons/{lesson_id}", response_model=Lesson)
async def get_lesson(lesson_id: str, db: Session = Depends(get_session)):
    lesson = _orch.get_lesson(lesson_id, db)
    if not lesson:
        raise HTTPException(404, "Lesson not found")
    return lesson


@router.get("/games/{game_id}", response_model=Game)
async def get_game(game_id: str, db: Session = Depends(get_session)):
    game = _orch.get_game(game_id, db)
    if not game:
        raise HTTPException(404, "Game not found")
    return game


@router.get("/games/{game_id}/full")
async def get_game_full(game_id: str, db: Session = Depends(get_session)):
    """Game plus its lesson — convenient single fetch for the frontend."""
    game = _orch.get_game(game_id, db)
    if not game:
        raise HTTPException(404, "Game not found")
    lesson = _orch.get_lesson(game.lesson_id, db)
    return {
        "game": game.model_dump(),
        "lesson": lesson.model_dump() if lesson else None,
    }
