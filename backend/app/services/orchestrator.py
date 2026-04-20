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
from app.prompts.lesson_prompts import (
    AI_FILL_SYSTEM_PROMPT,
    AI_FILL_USER_PROMPT_TEMPLATE,
)
from app.services.gemma_client import get_gemma_client
from app.services.pdf_parser import extract_from_file

log = get_logger(__name__)


class Orchestrator:
    def __init__(self) -> None:
        self.lesson_agent = LessonAgent()
        self.game_agent = GameAgent()
        self.reporting_agent = ReportingAgent()

    async def ingest_lesson(
        self, file_path: Path, db: Session, *, teacher_username: str = "anon",
    ) -> Lesson:
        """Parse the upload and persist the Lesson. No Game is built here."""
        text = await extract_from_file(file_path)
        return await self._persist_lesson_from_text(
            text, db, teacher_username=teacher_username,
        )

    async def ingest_pasted_text(
        self, text: str, db: Session, *,
        title: str | None = None, teacher_username: str = "anon",
    ) -> Lesson:
        """Accept raw pasted text; skip file I/O entirely."""
        return await self._persist_lesson_from_text(
            text, db, title=title, teacher_username=teacher_username,
        )

    async def ingest_with_ai_fill(
        self,
        *,
        topic: str,
        existing_text: str,
        db: Session,
        title: str | None = None,
        teacher_username: str = "anon",
    ) -> Lesson:
        """Top up thin source material with Gemma-generated context, then
        run the standard lesson pipeline over the combined text."""
        gemma = get_gemma_client()
        prompt = AI_FILL_USER_PROMPT_TEMPLATE.format(
            topic=(topic or "").strip()[:200] or "educational topic",
            existing_text=(existing_text or "").strip()[:4000],
        )
        generated = await gemma.generate(
            prompt=prompt,
            system=AI_FILL_SYSTEM_PROMPT,
            temperature=0.4,
            json_mode=False,
        )
        # Cap the generated slice so the combined input still fits under
        # MAX_SOURCE_CHARS after merge.
        generated = (generated or "").strip()[:2500]
        combined = (existing_text.rstrip() + "\n\n" + generated).strip()
        log.info(
            "lesson_ai_fill",
            existing_chars=len(existing_text or ""),
            generated_chars=len(generated),
            combined_chars=len(combined),
            topic=(topic or "")[:80],
        )
        return await self._persist_lesson_from_text(
            combined, db, title=title, teacher_username=teacher_username,
        )

    async def _persist_lesson_from_text(
        self, text: str, db: Session, *,
        title: str | None = None, teacher_username: str = "anon",
    ) -> Lesson:
        lesson = await self.lesson_agent.run(text)
        if title:
            lesson.title = title

        db.add(LessonRow(
            lesson_id=lesson.lesson_id,
            title=lesson.title,
            subject=lesson.subject,
            grade_level=lesson.grade_level,
            teacher_username=teacher_username,
            data=lesson.model_dump(),
        ))
        db.commit()
        return lesson

    def build_game(
        self, lesson_id: str, game_type: GameTypeId, db: Session,
        *, teacher_username: str | None = None,
    ) -> Game:
        """Turn a persisted Lesson into a Game of the requested type."""
        lesson_row = db.exec(
            select(LessonRow).where(LessonRow.lesson_id == lesson_id)
        ).first()
        if not lesson_row:
            raise ValueError(f"Unknown lesson_id: {lesson_id}")
        lesson = Lesson(**lesson_row.data)
        # Default to lesson owner if caller didn't specify one
        if teacher_username is None:
            teacher_username = lesson_row.teacher_username or "anon"
        game = self.game_agent.run(lesson, game_type=game_type)
        db.add(GameRow(
            game_id=game.game_id,
            lesson_id=lesson.lesson_id,
            teacher_username=teacher_username,
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
        run_stats: dict | None = None,
    ) -> Report:
        """Session ended -> build Report and persist."""
        game = self.get_game(game_id, db)
        if not game:
            raise ValueError(f"Unknown game_id: {game_id}")
        lesson = self.get_lesson(game.lesson_id, db)
        if not lesson:
            raise ValueError(f"Lesson missing for game {game_id}")

        # Pull identity off the session row so the report carries the same
        # student_name/teacher_username/client_ip for analytics.
        session_row = db.exec(
            select(SessionRow).where(SessionRow.session_id == session_id)
        ).first()
        student_name = session_row.student_name if session_row else "anon"
        teacher_username = session_row.teacher_username if session_row else "anon"
        client_ip = session_row.client_ip if session_row else ""

        # Self-play = the creator is playing their own game. Used to flip the
        # narrative into second person. Pull teacher_username off the lesson
        # row directly so we don't trust a client-supplied session field.
        lesson_row = db.exec(
            select(LessonRow).where(LessonRow.lesson_id == game.lesson_id)
        ).first()
        lesson_owner = lesson_row.teacher_username if lesson_row else ""
        player_name = student_name or "anon"
        is_self_play = bool(
            lesson_owner
            and lesson_owner != "anon"
            and player_name
            and player_name != "anon"
            and lesson_owner == player_name
        )

        report = await self.reporting_agent.run(
            student_id=student_id,
            lesson=lesson,
            session_summary=adaptation_summary,
            time_seconds=time_seconds,
            player_name=player_name,
            is_self_play=is_self_play,
        )

        stats = run_stats or {}
        db.add(ReportRow(
            report_id=report.report_id,
            session_id=session_id,
            student_id=student_id,
            student_name=student_name,
            teacher_username=teacher_username,
            client_ip=client_ip,
            lesson_id=lesson.lesson_id,
            data=report.model_dump(),
            score=int(stats.get("score", 0)),
            questions_answered=int(stats.get("questions_answered", 0)),
            questions_correct=int(stats.get("questions_correct", 0)),
            max_streak=int(stats.get("max_streak", 0)),
            time_seconds=int(time_seconds),
        ))
        db.commit()
        return report
