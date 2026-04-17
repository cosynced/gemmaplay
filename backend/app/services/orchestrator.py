"""Orchestrator: chains agents into the end-to-end flow.

Each agent stays independent — this module just wires them together
and persists intermediate artifacts. If you need to change the flow
(e.g. add a review step between Lesson and Game), do it here.
"""
from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from app.agents.game_agent import GameAgent
from app.agents.lesson_agent import LessonAgent
from app.agents.reporting_agent import ReportingAgent
from app.core.logging import get_logger
from app.db.models import GameRow, LessonRow, ReportRow, SessionRow
from app.models.schemas import Game, GameTypeId, Lesson, Report
from app.services.pdf_parser import extract_text

log = get_logger(__name__)


class Orchestrator:
    def __init__(self) -> None:
        self.lesson_agent = LessonAgent()
        self.game_agent = GameAgent()
        self.reporting_agent = ReportingAgent()

    async def ingest_lesson(self, file_path: Path, db: Session) -> Lesson:
        """Parse the upload and persist the Lesson. No Game is built here."""
        text = extract_text(file_path)
        lesson = await self.lesson_agent.run(text)

        db.add(LessonRow(
            lesson_id=lesson.lesson_id,
            title=lesson.title,
            subject=lesson.subject,
            grade_level=lesson.grade_level,
            data=lesson.model_dump(),
        ))
        db.commit()
        return lesson

    def build_game(
        self, lesson_id: str, game_type: GameTypeId, db: Session,
    ) -> Game:
        """Turn a persisted Lesson into a Game of the requested type."""
        lesson = self.get_lesson(lesson_id, db)
        if not lesson:
            raise ValueError(f"Unknown lesson_id: {lesson_id}")
        game = self.game_agent.run(lesson, game_type=game_type)
        db.add(GameRow(
            game_id=game.game_id,
            lesson_id=lesson.lesson_id,
            data=game.model_dump(),
        ))
        db.commit()
        return game

    def get_lesson(self, lesson_id: str, db: Session) -> Lesson | None:
        row = db.exec(
            select(LessonRow).where(LessonRow.lesson_id == lesson_id)
        ).first()
        return Lesson(**row.data) if row else None

    def get_game(self, game_id: str, db: Session) -> Game | None:
        row = db.exec(
            select(GameRow).where(GameRow.game_id == game_id)
        ).first()
        return Game(**row.data) if row else None

    async def finalize_session(
        self,
        *,
        session_id: str,
        student_id: str,
        game_id: str,
        time_seconds: int,
        adaptation_summary: dict,
        db: Session,
    ) -> Report:
        """Session ended -> build Report and persist."""
        game = self.get_game(game_id, db)
        if not game:
            raise ValueError(f"Unknown game_id: {game_id}")
        lesson = self.get_lesson(game.lesson_id, db)
        if not lesson:
            raise ValueError(f"Lesson missing for game {game_id}")

        report = await self.reporting_agent.run(
            student_id=student_id,
            lesson=lesson,
            session_summary=adaptation_summary,
            time_seconds=time_seconds,
        )

        db.add(ReportRow(
            report_id=report.report_id,
            session_id=session_id,
            student_id=student_id,
            lesson_id=lesson.lesson_id,
            data=report.model_dump(),
        ))
        db.commit()
        return report
