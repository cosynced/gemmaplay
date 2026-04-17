"""Lesson Agent: source material -> structured Lesson.

The ONLY agent that needs to deeply understand unstructured text.
Uses Gemma 4 with a strict JSON schema prompt and Pydantic validation.
"""
from __future__ import annotations

from pydantic import ValidationError

from app.core.logging import get_logger
from app.models.schemas import Lesson
from app.prompts.lesson_prompts import (
    LESSON_SYSTEM_PROMPT,
    LESSON_USER_PROMPT_TEMPLATE,
)
from app.services.gemma_client import get_gemma_client
from app.services.pdf_parser import text_hash

log = get_logger(__name__)

MAX_SOURCE_CHARS = 12000  # Stay within Gemma's context window comfortably


class LessonAgent:
    """Extracts concepts and questions from lesson material."""

    async def run(self, source_text: str) -> Lesson:
        """Main entry point. Returns a validated Lesson."""
        trimmed = source_text.strip()[:MAX_SOURCE_CHARS]
        if not trimmed:
            raise ValueError("Source text is empty")

        log.info("lesson_agent_start", chars=len(trimmed))
        gemma = get_gemma_client()

        prompt = LESSON_USER_PROMPT_TEMPLATE.format(source_text=trimmed)
        raw = await gemma.generate_json(
            prompt=prompt,
            system=LESSON_SYSTEM_PROMPT,
            temperature=0.2,
        )

        # Inject the source hash so we can cache/dedupe later
        raw["source_text_hash"] = text_hash(trimmed)

        try:
            lesson = Lesson(**raw)
        except ValidationError as e:
            log.error("lesson_validation_failed", errors=e.errors())
            raise ValueError(f"Lesson schema validation failed: {e}") from e

        log.info("lesson_agent_done",
                 lesson_id=lesson.lesson_id,
                 concepts=len(lesson.concepts))
        return lesson
