"""Reporting Agent: session log -> Report.

Numeric fields are computed deterministically.
The narrative uses Gemma 4 for a teacher-facing summary.
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.models.schemas import Lesson, Report
from app.prompts.report_prompts import (
    REPORT_SYSTEM_PROMPT,
    REPORT_USER_PROMPT_TEMPLATE,
)
from app.services.gemma_client import get_gemma_client

log = get_logger(__name__)


class ReportingAgent:
    """Summarizes a session into a Report."""

    async def run(
        self,
        *,
        student_id: str,
        lesson: Lesson,
        session_summary: dict,
        time_seconds: int,
    ) -> Report:
        log.info("reporting_agent_start", student_id=student_id,
                 lesson_id=lesson.lesson_id)

        concepts_mastered: list[str] = []
        concepts_weak: list[str] = []
        total_correct = 0
        total_answered = 0
        hints_total = 0

        concept_by_id = {c.id: c for c in lesson.concepts}
        for cid, stats in session_summary.get("per_concept", {}).items():
            correct = stats.get("correct", 0)
            wrong = stats.get("wrong", 0)
            hints = stats.get("hints", 0)
            total_correct += correct
            total_answered += correct + wrong
            hints_total += hints

            # Mastery: 2+ correct with no hints on that concept
            if correct >= 2 and hints == 0:
                concepts_mastered.append(cid)
            elif wrong >= correct:
                concepts_weak.append(cid)

        score = round((total_correct / total_answered) * 100) if total_answered else 0

        narrative = await self._generate_narrative(
            lesson=lesson,
            score=score,
            time_seconds=time_seconds,
            hints_used=hints_total,
            mastered=[concept_by_id[c].name for c in concepts_mastered
                      if c in concept_by_id],
            weak=[concept_by_id[c].name for c in concepts_weak
                  if c in concept_by_id],
        )

        report = Report(
            student_id=student_id,
            lesson_id=lesson.lesson_id,
            score=score,
            concepts_mastered=concepts_mastered,
            concepts_weak=concepts_weak,
            time_seconds=time_seconds,
            hints_used=hints_total,
            narrative=narrative,
        )
        log.info("reporting_agent_done", report_id=report.report_id, score=score)
        return report

    async def _generate_narrative(
        self, *, lesson: Lesson, score: int, time_seconds: int,
        hints_used: int, mastered: list[str], weak: list[str],
    ) -> str:
        gemma = get_gemma_client()
        prompt = REPORT_USER_PROMPT_TEMPLATE.format(
            lesson_title=lesson.title,
            score=score,
            time_seconds=time_seconds,
            hints_used=hints_used,
            mastered=", ".join(mastered) or "none yet",
            weak=", ".join(weak) or "none",
        )
        try:
            text = await gemma.generate(
                prompt=prompt,
                system=REPORT_SYSTEM_PROMPT,
                temperature=0.7,
                json_mode=False,
            )
            return text.strip()
        except Exception as e:
            log.warning("narrative_generation_failed", error=str(e))
            # Fallback narrative so reports always have one
            return (
                f"Student scored {score}/100 on {lesson.title}. "
                f"Strong areas: {', '.join(mastered) or 'still developing'}. "
                f"Focus next: {', '.join(weak) or 'general review'}."
            )
