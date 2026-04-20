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
    tone_bucket_for_score,
    tone_guidance_for,
)
from app.services.gemma_client import get_gemma_client

log = get_logger(__name__)


# Offline fallback lines per bucket so a Gemma failure never produces a
# cheerful "Nice work!" on a zero-score run.
_FALLBACK_OPENINGS = {
    "struggling": "This one was tough.",
    "partial": "Mixed results.",
    "solid": "Good run.",
    "strong": "Excellent work.",
}


class ReportingAgent:
    """Summarizes a session into a Report."""

    async def run(
        self,
        *,
        student_id: str,
        lesson: Lesson,
        session_summary: dict,
        time_seconds: int,
        player_name: str = "anon",
        is_self_play: bool = False,
    ) -> Report:
        log.info(
            "reporting_agent_start",
            student_id=student_id,
            lesson_id=lesson.lesson_id,
            player_name=player_name,
            is_self_play=is_self_play,
        )

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
            player_name=player_name,
            is_self_play=is_self_play,
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
        player_name: str, is_self_play: bool,
    ) -> str:
        bucket = tone_bucket_for_score(score)
        pov = "second_person" if is_self_play else "third_person"
        display_name = (player_name or "").strip() or "the player"

        gemma = get_gemma_client()
        prompt = REPORT_USER_PROMPT_TEMPLATE.format(
            player_name=display_name,
            point_of_view=pov,
            tone_bucket=bucket,
            tone_guidance=tone_guidance_for(bucket),
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
            cleaned = self._scrub_placeholders(
                text.strip(), display_name=display_name, is_self_play=is_self_play,
            )
            return cleaned
        except Exception as e:
            log.warning("narrative_generation_failed", error=str(e))
            return self._fallback_narrative(
                bucket=bucket,
                lesson_title=lesson.title,
                mastered=mastered,
                weak=weak,
                display_name=display_name,
                is_self_play=is_self_play,
            )

    def _scrub_placeholders(
        self, text: str, *, display_name: str, is_self_play: bool,
    ) -> str:
        """Last line of defence. If Gemma slipped "[Student Name]" or a
        bare "Student" label into the output, patch it locally so the
        user never sees it."""
        replacements = (
            ("[Student Name]", display_name),
            ("[student name]", display_name),
            ("[Student]", display_name),
            ("[Player]", display_name),
            ("[player]", display_name),
            ("[Name]", display_name),
        )
        for needle, replacement in replacements:
            text = text.replace(needle, replacement)
        return text.strip()

    def _fallback_narrative(
        self, *, bucket: str, lesson_title: str,
        mastered: list[str], weak: list[str],
        display_name: str, is_self_play: bool,
    ) -> str:
        opener = _FALLBACK_OPENINGS.get(bucket, "Mixed results.")
        strong = ", ".join(mastered) or "still developing"
        focus = ", ".join(weak) or "general review"
        if is_self_play:
            return (
                f"{opener} You're strong on {strong} in {lesson_title}. "
                f"Focus next on {focus}."
            )
        return (
            f"{opener} {display_name} is strong on {strong} in "
            f"{lesson_title}. They should focus next on {focus}."
        )
