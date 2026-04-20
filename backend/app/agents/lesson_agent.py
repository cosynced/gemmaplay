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
MIN_SOURCE_CHARS = 100
MAX_CONCEPT_NAME_LEN = 100
MIN_CONCEPTS = 3
MIN_QUESTIONS_PER_CONCEPT = 8
MIN_AVG_SUMMARY_LEN = 30  # shorter than this is shallow/generic output
MIN_TOTAL_QUESTIONS = 24  # 3 concepts × 8 questions floor

REFUSAL_PREFIXES = ("I cannot", "As an AI")


class InsufficientContentError(Exception):
    """Gemma returned a valid-but-thin lesson — not enough to build a game.

    The partial_lesson is whatever Pydantic accepted (may be empty). We keep
    it around so the API layer can tell the user what they got so far without
    a second Gemma call.
    """

    def __init__(
        self,
        message: str,
        *,
        concepts_found: int,
        questions_found: int,
        partial_lesson: Lesson | None = None,
    ) -> None:
        super().__init__(message)
        self.concepts_found = concepts_found
        self.questions_found = questions_found
        self.partial_lesson = partial_lesson


class LessonAgent:
    """Extracts concepts and questions from lesson material."""

    async def run(self, source_text: str) -> Lesson:
        """Main entry point. Returns a validated Lesson."""
        stripped = source_text.strip()
        if len(stripped) < MIN_SOURCE_CHARS:
            raise ValueError("content too short")

        trimmed = stripped
        if len(trimmed) > MAX_SOURCE_CHARS:
            log.info(
                "lesson_source_truncated",
                original_chars=len(trimmed),
                kept_chars=MAX_SOURCE_CHARS,
            )
            trimmed = trimmed[:MAX_SOURCE_CHARS]

        log.info("lesson_agent_start", chars=len(trimmed))
        gemma = get_gemma_client()

        prompt = LESSON_USER_PROMPT_TEMPLATE.format(source_text=trimmed)
        raw = await gemma.generate_json(
            prompt=prompt,
            system=LESSON_SYSTEM_PROMPT,
            temperature=0.2,
            max_tokens=8192,
        )

        raw["source_text_hash"] = text_hash(trimmed)

        try:
            lesson = Lesson(**raw)
        except ValidationError as e:
            # Pydantic rejected the shape entirely (e.g. < 3 concepts violates
            # the Lesson schema min_length). Surface as insufficient content
            # so the UI can offer to top it up.
            concepts = raw.get("concepts") if isinstance(raw, dict) else None
            concept_count = len(concepts) if isinstance(concepts, list) else 0
            question_count = 0
            if isinstance(concepts, list):
                for c in concepts:
                    if isinstance(c, dict):
                        qs = c.get("questions")
                        if isinstance(qs, list):
                            question_count += len(qs)
            log.warning(
                "lesson_schema_below_minimum",
                concepts=concept_count,
                questions=question_count,
                errors=e.errors(),
            )
            raise InsufficientContentError(
                "Your content didn't have enough for a full game.",
                concepts_found=concept_count,
                questions_found=question_count,
                partial_lesson=None,
            ) from e

        self._check_sufficiency(lesson)
        self._sanity_check(lesson)

        log.info("lesson_agent_done",
                 lesson_id=lesson.lesson_id,
                 concepts=len(lesson.concepts))
        return lesson

    def _check_sufficiency(self, lesson: Lesson) -> None:
        concept_count = len(lesson.concepts)
        total_questions = sum(len(c.questions) for c in lesson.concepts)
        avg_summary = (
            sum(len(c.summary) for c in lesson.concepts) / concept_count
            if concept_count else 0
        )

        too_few_concepts = concept_count < MIN_CONCEPTS
        thin_concept = any(
            len(c.questions) < MIN_QUESTIONS_PER_CONCEPT for c in lesson.concepts
        )
        shallow = avg_summary < MIN_AVG_SUMMARY_LEN

        if too_few_concepts or thin_concept or shallow:
            log.warning(
                "lesson_insufficient_content",
                concepts=concept_count,
                questions=total_questions,
                avg_summary_chars=round(avg_summary, 1),
            )
            raise InsufficientContentError(
                "Your content didn't have enough for a full game.",
                concepts_found=concept_count,
                questions_found=total_questions,
                partial_lesson=lesson,
            )

    def _sanity_check(self, lesson: Lesson) -> None:
        """Post-Pydantic guards against obviously-broken or refusal outputs."""
        total_questions = sum(len(c.questions) for c in lesson.concepts)
        if total_questions < MIN_TOTAL_QUESTIONS:
            log.error(
                "lesson_sanity_too_few_questions",
                total_questions=total_questions,
            )
            raise ValueError(
                f"Lesson only produced {total_questions} questions; need at "
                f"least {MIN_TOTAL_QUESTIONS}. Try pasting more source text."
            )

        for concept in lesson.concepts:
            if len(concept.name) > MAX_CONCEPT_NAME_LEN:
                log.error(
                    "lesson_sanity_concept_name_too_long",
                    concept_id=concept.id,
                    length=len(concept.name),
                )
                raise ValueError(
                    f"Concept name too long ({len(concept.name)} chars). "
                    "Reject and retry with shorter source text."
                )
            for prefix in REFUSAL_PREFIXES:
                if concept.name.startswith(prefix) or concept.summary.startswith(prefix):
                    log.error(
                        "lesson_sanity_refusal_detected",
                        concept_id=concept.id,
                        prefix=prefix,
                    )
                    raise ValueError(
                        "Lesson extraction looks like a model refusal, not "
                        "lesson content. Try a different source."
                    )
