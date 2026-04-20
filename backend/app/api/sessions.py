"""Gameplay session routes: start, stream events, finalize into a report."""
import re
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from tenacity import RetryError

from app.agents.adaptation_agent import AdaptationAgent
from app.api.dependencies import get_current_username
from app.core.logging import get_logger
from app.core.rate_limit import limiter
from app.db.models import GameRow, ReportRow, SessionRow
from app.db.session import get_session
from app.models.schemas import AdaptationSignal, GameplayEvent, Report
from app.services.orchestrator import Orchestrator

log = get_logger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Adaptation state is in-memory and shared across the process.
# Fine for the MVP (single worker). If you scale to multiple Cloud Run
# instances, move this to Redis or Cloud Memorystore.
_adapter = AdaptationAgent()
_orch = Orchestrator()

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{2,24}$")


def _clean_name(raw: str | None, default: str = "anon") -> str:
    if not raw:
        return default
    name = raw.strip()
    if name == "" or name == "anon":
        return default
    if not USERNAME_RE.match(name):
        raise HTTPException(
            400, "Invalid name (2-24 chars, alphanum + underscore).",
        )
    return name


class SessionStartIn(BaseModel):
    game_id: str
    student_id: str = "demo_student"
    student_name: str | None = None
    teacher_username: str | None = None


class SessionStartOut(BaseModel):
    session_id: str
    game_id: str
    started_at: str
    student_name: str
    teacher_username: str


class SessionEndIn(BaseModel):
    session_id: str
    game_id: str
    student_id: str = "demo_student"
    time_seconds: int
    # Infinite-game run stats. Optional so older clients still work.
    score: int = 0
    questions_answered: int = 0
    questions_correct: int = 0
    max_streak: int = 0


@router.post("/start", response_model=SessionStartOut)
@limiter.limit("20/minute")
async def start_session(
    request: Request,
    payload: SessionStartIn,
    db: Session = Depends(get_session),
):
    student_name = _clean_name(payload.student_name)
    # If the client didn't pass a usable student_name but is signed in,
    # default the session to the authenticated username. This is how the
    # creator's own playthroughs get tagged as themselves (and in turn
    # triggers second-person narrative in the report).
    if student_name == "anon":
        session_user = get_current_username(request)
        if session_user:
            student_name = _clean_name(session_user)
    # Prefer the game's owner as the teacher tag so analytics stay correct
    # even if the client omits or lies about teacher_username.
    game_row = db.exec(
        select(GameRow).where(GameRow.game_id == payload.game_id)
    ).first()
    if not game_row:
        raise HTTPException(404, "Game not found")
    teacher = game_row.teacher_username or _clean_name(payload.teacher_username)
    if teacher == "anon" and payload.teacher_username:
        teacher = _clean_name(payload.teacher_username)

    client_ip = request.client.host if request.client else ""
    session_id = f"ses_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    db.add(SessionRow(
        session_id=session_id,
        game_id=payload.game_id,
        student_id=payload.student_id,
        student_name=student_name,
        teacher_username=teacher,
        client_ip=client_ip,
        started_at=now,
        events=[],
    ))
    db.commit()
    log.info(
        "session_started",
        session_id=session_id,
        game_id=payload.game_id,
        student_name=student_name,
        teacher=teacher,
    )
    return SessionStartOut(
        session_id=session_id,
        game_id=payload.game_id,
        started_at=now.isoformat(),
        student_name=student_name,
        teacher_username=teacher,
    )


@router.post("/event", response_model=AdaptationSignal)
@limiter.limit("120/minute")
async def post_event(request: Request, event: GameplayEvent):
    """Student answered a question. Returns an adaptation signal for the game."""
    return _adapter.process(event)


@router.post("/end", response_model=Report)
@limiter.limit("20/minute")
async def end_session(
    request: Request,
    payload: SessionEndIn,
    db: Session = Depends(get_session),
):
    row = db.exec(
        select(SessionRow).where(SessionRow.session_id == payload.session_id)
    ).first()
    if not row:
        raise HTTPException(404, "Session not found")

    summary = _adapter.session_summary(payload.session_id)
    # Persist run stats on the SessionRow (pre-commit so finalize can read).
    row.score = payload.score
    row.questions_answered = payload.questions_answered
    row.questions_correct = payload.questions_correct
    row.max_streak = payload.max_streak
    row.time_seconds = payload.time_seconds
    db.add(row)
    db.commit()
    try:
        report = await _orch.finalize_session(
            session_id=payload.session_id,
            student_id=payload.student_id,
            game_id=payload.game_id,
            time_seconds=payload.time_seconds,
            adaptation_summary=summary,
            db=db,
            run_stats={
                "score": payload.score,
                "questions_answered": payload.questions_answered,
                "questions_correct": payload.questions_correct,
                "max_streak": payload.max_streak,
            },
        )
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    except RetryError as e:
        inner = e.last_attempt.exception() if e.last_attempt else None
        detail = f"{inner.__class__.__name__}: {inner}" if inner else str(e)
        log.exception("end_session_retry_failed")
        raise HTTPException(502, f"Report generation failed: {detail}.") from e
    except Exception as e:  # noqa: BLE001
        log.exception("end_session_failed")
        raise HTTPException(
            502,
            f"Report generation failed: {e.__class__.__name__}: {e}.",
        ) from e
    row.ended_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()
    return report


@router.get("/reports", response_model=list[dict])
async def list_reports(db: Session = Depends(get_session)):
    rows = db.exec(select(ReportRow).order_by(ReportRow.created_at.desc())).all()
    return [
        {
            "report_id": r.report_id,
            "student_id": r.student_id,
            "student_name": r.student_name,
            "teacher_username": r.teacher_username,
            "lesson_id": r.lesson_id,
            "score": r.data.get("score"),
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/reports/{report_id}", response_model=Report)
async def get_report(report_id: str, db: Session = Depends(get_session)):
    row = db.exec(
        select(ReportRow).where(ReportRow.report_id == report_id)
    ).first()
    if not row:
        raise HTTPException(404, "Report not found")
    return Report(**row.data)
