"""Lesson upload + game retrieval endpoints."""
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Header, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select
from tenacity import RetryError

from app.agents.lesson_agent import InsufficientContentError
from app.api.dependencies import get_current_username
from app.core.logging import get_logger
from app.core.rate_limit import limiter
from app.db.models import GameRow, LessonRow
from app.db.session import get_session
from app.models.schemas import GAME_TYPES, Game, GameTypeId, Lesson
from app.services.content_inspection import (
    MAX_SOURCE_CHARS,
    SUPPORTED_SUFFIXES,
    inspect_file,
    inspect_text,
)
from app.services.orchestrator import Orchestrator

log = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["lessons"])
_orch = Orchestrator()

ALLOWED_SUFFIXES = {
    ".pdf", ".txt", ".md", ".docx", ".pptx", ".png", ".jpg", ".jpeg",
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB — images and scans need headroom
MIN_PASTE_CHARS = 50

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{2,24}$")
# Every game_type id we auto-create when a teacher claims a lesson.
AUTO_GAME_TYPES: tuple[str, ...] = (
    "lane_runner", "tetris_answer", "shooter_answer", "snake_knowledge",
)


def _unwrap_retry_error(exc: BaseException) -> str:
    """Pull the underlying cause out of a tenacity RetryError for display."""
    if isinstance(exc, RetryError):
        try:
            inner = exc.last_attempt.exception() if exc.last_attempt else None
        except Exception:  # noqa: BLE001
            inner = None
        if inner is not None:
            return f"{inner.__class__.__name__}: {inner}"
    return f"{exc.__class__.__name__}: {exc}"


def _insufficient_response(exc: InsufficientContentError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "code": "insufficient_content",
            "message": str(exc) or "Your content didn't have enough for a full game.",
            "partial": {
                "concepts_found": exc.concepts_found,
                "questions_found": exc.questions_found,
            },
            "options": [
                {"id": "add_more", "label": "Upload more material"},
                {"id": "ai_fill", "label": "Let Gemma generate supplementary content"},
            ],
        },
    )


def _teacher_username(x_teacher_username: str | None) -> str:
    """Parse and validate the X-Teacher-Username header. Missing ⇒ 'anon'."""
    if not x_teacher_username:
        return "anon"
    name = x_teacher_username.strip()
    if name == "" or name == "anon":
        return "anon"
    if not USERNAME_RE.match(name):
        raise HTTPException(
            400, "Invalid teacher username (2-24 chars, alphanum + underscore).",
        )
    return name


def _effective_teacher(request: Request, x_teacher_username: str | None) -> str:
    """Session token wins; fall back to the X-Teacher-Username header."""
    session_user = get_current_username(request)
    if session_user:
        return session_user
    return _teacher_username(x_teacher_username)


@router.post("/lessons", response_model=dict)
@limiter.limit("5/minute;30/hour")
async def upload_lesson(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
    x_teacher_username: str | None = Header(default=None),
):
    """Upload a lesson file. Returns lesson metadata only — game generation
    happens separately via POST /api/games so the teacher can pick a type."""
    teacher = _effective_teacher(request, x_teacher_username)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"Unsupported file type. Allowed: {ALLOWED_SUFFIXES}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (10 MB limit)")
    if not data:
        raise HTTPException(400, "Empty file")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        lesson = await _orch.ingest_lesson(tmp_path, db, teacher_username=teacher)
    except InsufficientContentError as e:
        log.warning("ingest_insufficient_content", error=str(e))
        return _insufficient_response(e)
    except ValueError as e:
        log.error("ingest_failed", error=str(e))
        raise HTTPException(422, str(e)) from e
    except NotImplementedError as e:
        log.error("ingest_unsupported_provider", error=str(e))
        raise HTTPException(501, str(e)) from e
    except Exception as e:  # noqa: BLE001
        detail = _unwrap_retry_error(e)
        log.exception("ingest_upstream_failed")
        raise HTTPException(
            502,
            f"Content extraction failed: {detail}. "
            "Try a different file or paste the text directly.",
        ) from e
    finally:
        tmp_path.unlink(missing_ok=True)

    return {
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "concepts": len(lesson.concepts),
    }


class PasteLessonRequest(BaseModel):
    text: str
    title: str | None = None


@router.post("/lessons/paste", response_model=dict)
@limiter.limit("5/minute;30/hour")
async def paste_lesson(
    request: Request,
    body: PasteLessonRequest,
    db: Session = Depends(get_session),
    x_teacher_username: str | None = Header(default=None),
):
    """Accept pasted lesson text directly — no file upload required."""
    teacher = _effective_teacher(request, x_teacher_username)

    text = body.text or ""
    if len(text.strip()) < MIN_PASTE_CHARS:
        raise HTTPException(
            400,
            f"Please paste at least {MIN_PASTE_CHARS} characters of lesson content.",
        )

    try:
        lesson = await _orch.ingest_pasted_text(
            text, db, title=body.title, teacher_username=teacher,
        )
    except InsufficientContentError as e:
        log.warning("paste_insufficient_content", error=str(e))
        return _insufficient_response(e)
    except ValueError as e:
        log.error("paste_ingest_failed", error=str(e))
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # noqa: BLE001
        detail = _unwrap_retry_error(e)
        log.exception("paste_upstream_failed")
        raise HTTPException(502, f"Lesson generation failed: {detail}.") from e

    return {
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "concepts": len(lesson.concepts),
    }


@router.post("/lessons/inspect", response_model=dict)
async def inspect_lesson(request: Request):
    """Cheap content inspection. No Gemma call, no persistence. Dispatches
    on content-type so one endpoint can accept either a multipart file or
    a JSON `{ "text": "..." }` body.
    """
    ctype = (request.headers.get("content-type") or "").lower()

    if ctype.startswith("multipart/"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "filename"):
            return {
                "char_count": 0,
                "will_truncate": False,
                "truncate_at_chars": MAX_SOURCE_CHARS,
                "estimated_pages": None,
                "pages_to_process": 0,
                "file_type": "unknown",
                "ok": False,
            }
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in SUPPORTED_SUFFIXES:
            return {
                "char_count": 0,
                "will_truncate": False,
                "truncate_at_chars": MAX_SOURCE_CHARS,
                "estimated_pages": None,
                "pages_to_process": 0,
                "file_type": suffix.lstrip(".") or "unknown",
                "ok": False,
            }
        data = await upload.read()
        if len(data) > 10 * 1024 * 1024:
            return {
                "char_count": 0,
                "will_truncate": True,
                "truncate_at_chars": MAX_SOURCE_CHARS,
                "estimated_pages": None,
                "pages_to_process": 0,
                "file_type": suffix.lstrip("."),
                "ok": False,
            }
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        try:
            return inspect_file(tmp_path).to_dict()
        finally:
            tmp_path.unlink(missing_ok=True)

    # JSON path
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}
    text = (body.get("text") if isinstance(body, dict) else None) or ""
    return inspect_text(text).to_dict()


class AiFillRequest(BaseModel):
    topic: str
    existing_text: str
    title: str | None = None


@router.post("/lessons/ai-fill", response_model=dict)
@limiter.limit("5/minute;30/hour")
async def ai_fill_lesson(
    request: Request,
    body: AiFillRequest,
    db: Session = Depends(get_session),
    x_teacher_username: str | None = Header(default=None),
):
    """Generate supplementary text via Gemma and run it through the normal
    lesson pipeline. Used by the 'Let Gemma fill the gaps' UX after an
    insufficient_content rejection."""
    teacher = _effective_teacher(request, x_teacher_username)
    topic = (body.topic or "").strip()
    existing = (body.existing_text or "").strip()
    if len(topic) < 2:
        raise HTTPException(400, "Topic is required.")
    if not existing:
        raise HTTPException(400, "existing_text is required.")

    try:
        lesson = await _orch.ingest_with_ai_fill(
            topic=topic,
            existing_text=existing,
            db=db,
            title=body.title,
            teacher_username=teacher,
        )
    except InsufficientContentError as e:
        log.warning("ai_fill_still_insufficient", error=str(e))
        return _insufficient_response(e)
    except ValueError as e:
        log.error("ai_fill_failed", error=str(e))
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # noqa: BLE001
        detail = _unwrap_retry_error(e)
        log.exception("ai_fill_upstream_failed")
        raise HTTPException(502, f"AI fill failed: {detail}.") from e

    return {
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "concepts": len(lesson.concepts),
    }


class ClaimLessonRequest(BaseModel):
    teacher_username: str


@router.patch("/lessons/{lesson_id}/claim", response_model=dict)
@limiter.limit("10/minute")
async def claim_lesson(
    request: Request,
    lesson_id: str,
    body: ClaimLessonRequest,
    db: Session = Depends(get_session),
):
    """Attach a teacher username to an anonymously-created lesson, then
    auto-create one Game per supported game_type so the student picker is
    always fully populated. Requires a valid session; the body username
    must match the session's user."""
    session_user = get_current_username(request)
    if not session_user:
        raise HTTPException(401, "Sign in required to claim a lesson.")

    name = (body.teacher_username or "").strip()
    if not USERNAME_RE.match(name):
        raise HTTPException(400, "Invalid username (2-24 chars, alphanum + underscore).")
    if name != session_user:
        raise HTTPException(403, "Body username does not match the signed-in user.")

    row = db.exec(
        select(LessonRow).where(LessonRow.lesson_id == lesson_id)
    ).first()
    if not row:
        raise HTTPException(404, "Lesson not found")
    if row.teacher_username not in ("", "anon"):
        if row.teacher_username == name:
            # Idempotent: already owned by this user. Continue so auto-create
            # fills in any missing game types.
            pass
        else:
            raise HTTPException(409, "Lesson is already claimed.")

    row.teacher_username = name
    db.add(row)

    # Promote any already-created games for this lesson (e.g. a racing
    # frontend built one before the claim).
    existing_games = db.exec(
        select(GameRow).where(GameRow.lesson_id == lesson_id)
    ).all()
    existing_types: set[str] = set()
    for g in existing_games:
        g.teacher_username = name
        db.add(g)
        existing_types.add((g.data or {}).get("game_type", ""))
    db.commit()

    # Auto-create missing game types so the student gets a full picker.
    created: list[dict] = []
    for gt in AUTO_GAME_TYPES:
        if gt in existing_types:
            continue
        try:
            game = _orch.build_game(lesson_id, gt, db, teacher_username=name)
            created.append({"game_id": game.game_id, "game_type": game.game_type})
        except ValueError as e:
            log.error("auto_game_failed", game_type=gt, error=str(e))

    return {
        "lesson_id": lesson_id,
        "teacher_username": name,
        "games_created": created,
    }


def _concept_notes_with_fallback(lesson_data: dict) -> str | None:
    """Return the stored concept_notes, or synthesize one from concept summaries.

    Legacy lessons predate the `concept_notes` field. Rather than re-running
    Gemma just to add notes, we stitch together each concept's summary into
    the same markdown shape the LLM would produce, so the frontend treats
    both code paths identically.
    """
    notes = (lesson_data or {}).get("concept_notes")
    if notes and str(notes).strip():
        return str(notes)
    concepts = (lesson_data or {}).get("concepts") or []
    parts: list[str] = []
    for c in concepts:
        name = (c.get("name") or "").strip()
        summary = (c.get("summary") or "").strip()
        if not name and not summary:
            continue
        heading = f"## {name}" if name else "##"
        parts.append(f"{heading}\n\n{summary}".rstrip())
    return "\n\n".join(parts) if parts else None


@router.get("/lessons/{lesson_id}/public", response_model=dict)
async def public_lesson(lesson_id: str, db: Session = Depends(get_session)):
    """Minimal lesson metadata for shared student links. No teacher auth."""
    row = db.exec(
        select(LessonRow).where(LessonRow.lesson_id == lesson_id)
    ).first()
    if not row:
        raise HTTPException(404, "Lesson not found")
    return {
        "lesson_id": row.lesson_id,
        "title": row.title,
        "subject": row.subject,
        "grade_level": row.grade_level,
        "concepts": len((row.data or {}).get("concepts", [])),
        "concept_notes": _concept_notes_with_fallback(row.data or {}),
    }


@router.get("/games/by-lesson/{lesson_id}", response_model=list[dict])
async def games_by_lesson(lesson_id: str, db: Session = Depends(get_session)):
    """List every Game row built for this lesson. Public by design so
    students arriving via a share link can see what's available."""
    lesson_row = db.exec(
        select(LessonRow).where(LessonRow.lesson_id == lesson_id)
    ).first()
    if not lesson_row:
        raise HTTPException(404, "Lesson not found")
    rows = db.exec(
        select(GameRow).where(GameRow.lesson_id == lesson_id)
            .order_by(GameRow.created_at.asc())
    ).all()
    return [
        {
            "game_id": r.game_id,
            "game_type": (r.data or {}).get("game_type", ""),
            "lesson_id": r.lesson_id,
        }
        for r in rows
    ]


@router.get("/game-types", response_model=list[dict])
async def list_game_types():
    """Metadata for every game type the picker can offer."""
    return GAME_TYPES


class CreateGameRequest(BaseModel):
    lesson_id: str
    game_type: GameTypeId = "lane_runner"


@router.post("/games", response_model=dict)
@limiter.limit("10/minute;60/hour")
async def create_game(
    request: Request,
    body: CreateGameRequest,
    db: Session = Depends(get_session),
    x_teacher_username: str | None = Header(default=None),
):
    """Build and persist a Game of the requested type for an existing lesson."""
    teacher = _effective_teacher(request, x_teacher_username)
    try:
        game = _orch.build_game(
            body.lesson_id, body.game_type, db,
            teacher_username=teacher if teacher != "anon" else None,
        )
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return {
        "game_id": game.game_id,
        "game_type": game.game_type,
        "lesson_id": game.lesson_id,
    }


@router.get("/lessons", response_model=list[dict])
async def list_lessons(
    request: Request,
    db: Session = Depends(get_session),
):
    """List the signed-in user's lessons. Anonymous callers get an empty list
    — lesson ownership is tied to authenticated accounts now, not a freely
    sent header."""
    session_user = get_current_username(request)
    if not session_user:
        return []
    stmt = (
        select(LessonRow)
        .where(LessonRow.teacher_username == session_user)
        .order_by(LessonRow.created_at.desc())
    )
    rows = db.exec(stmt).all()
    return [
        {
            "lesson_id": r.lesson_id,
            "title": r.title,
            "subject": r.subject,
            "grade_level": r.grade_level,
            "teacher_username": r.teacher_username,
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
    lesson_dict = lesson.model_dump() if lesson else None
    if lesson_dict is not None and not lesson_dict.get("concept_notes"):
        # Back-fill for legacy rows that were persisted before the field existed.
        lesson_dict["concept_notes"] = _concept_notes_with_fallback(lesson_dict)
    return {
        "game": game.model_dump(),
        "lesson": lesson_dict,
    }
