"""Gameplay session routes: start, stream events, finalize into a report."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.agents.adaptation_agent import AdaptationAgent
from app.core.logging import get_logger
from app.db.models import ReportRow, SessionRow
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


class SessionStartIn(BaseModel):
    game_id: str
    student_id: str = "demo_student"


class SessionStartOut(BaseModel):
    session_id: str
    game_id: str
    started_at: str


class SessionEndIn(BaseModel):
    session_id: str
    game_id: str
    student_id: str = "demo_student"
    time_seconds: int


@router.post("/start", response_model=SessionStartOut)
async def start_session(
    payload: SessionStartIn, db: Session = Depends(get_session)
):
    session_id = f"ses_{uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    db.add(SessionRow(
        session_id=session_id,
        game_id=payload.game_id,
        student_id=payload.student_id,
        started_at=now,
        events=[],
    ))
    db.commit()
    log.info("session_started", session_id=session_id, game_id=payload.game_id)
    return SessionStartOut(
        session_id=session_id,
        game_id=payload.game_id,
        started_at=now.isoformat(),
    )


@router.post("/event", response_model=AdaptationSignal)
async def post_event(event: GameplayEvent):
    """Student answered a question. Returns an adaptation signal for the game."""
    return _adapter.process(event)


@router.post("/end", response_model=Report)
async def end_session(
    payload: SessionEndIn, db: Session = Depends(get_session)
):
    row = db.exec(
        select(SessionRow).where(SessionRow.session_id == payload.session_id)
    ).first()
    if not row:
        raise HTTPException(404, "Session not found")

    summary = _adapter.session_summary(payload.session_id)
    report = await _orch.finalize_session(
        session_id=payload.session_id,
        student_id=payload.student_id,
        game_id=payload.game_id,
        time_seconds=payload.time_seconds,
        adaptation_summary=summary,
        db=db,
    )
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
