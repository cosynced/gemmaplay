"""Pydantic schemas defining agent I/O contracts.

These are the source of truth for the data flowing between agents.
Change carefully — every agent honors this shape.
"""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


# ---------- Lesson Agent output ----------

class Question(BaseModel):
    id: str = Field(default_factory=lambda: f"q_{uuid4().hex[:8]}")
    q: str
    options: list[str] = Field(min_length=2, max_length=4)
    answer_index: int = Field(ge=0, le=3)
    difficulty: Literal["easy", "medium", "hard"] = "medium"


class Concept(BaseModel):
    id: str = Field(default_factory=lambda: f"c_{uuid4().hex[:8]}")
    name: str
    summary: str
    questions: list[Question] = Field(min_length=1, max_length=20)


class Lesson(BaseModel):
    lesson_id: str = Field(default_factory=lambda: f"les_{uuid4().hex[:12]}")
    title: str
    subject: str = "General"
    grade_level: str = "Unknown"
    source_text_hash: str = ""
    concepts: list[Concept] = Field(min_length=3, max_length=5)
    # Markdown-formatted reference notes shown alongside gameplay. One `##`
    # section per concept, 2-4 sentences each, never hinting at answers.
    # Optional so legacy rows (generated before this field existed) still
    # load; callers fall back to concatenating `concept.summary` when absent.
    concept_notes: str | None = None


# ---------- Game Agent output ----------

class Level(BaseModel):
    level_id: str
    concept_id: str
    target_distance: int = 1000
    base_speed: int = 200
    obstacle_density: float = Field(default=0.3, ge=0.0, le=1.0)
    questions: list[str]  # question ids


GameTypeId = Literal[
    "lane_runner", "tetris_answer", "shooter_answer", "snake_knowledge",
    "quiz_runner",
]


class Game(BaseModel):
    game_id: str = Field(default_factory=lambda: f"gam_{uuid4().hex[:12]}")
    lesson_id: str
    game_type: GameTypeId = "lane_runner"
    levels: list[Level]


# Metadata for the teacher-facing picker. Order matters — first item is the
# default/recommended choice. Add a new game type here (and a corresponding
# scene on the frontend) to surface it in the picker.
GAME_TYPES: list[dict] = [
    {
        "id": "lane_runner",
        "name": "Lane Runner",
        "description": "Temple Run-style endless runner. Steer into correct-answer doors.",
        "best_for": "Any lesson. High-energy, broad appeal.",
    },
    {
        "id": "tetris_answer",
        "name": "Answer Stacker",
        "description": "Tetris-style. Drop labeled blocks into the correct bin.",
        "best_for": "Categorical content, vocabulary, definitions.",
    },
    {
        "id": "shooter_answer",
        "name": "Answer Blaster",
        "description": "Space Invaders-style. Shoot the correct falling answer.",
        "best_for": "Fast recall, quick-fire quizzes.",
    },
    {
        "id": "snake_knowledge",
        "name": "Snake Knowledge",
        "description": (
            "Classic Snake meets learning. Eat the correct answer letter — "
            "the wrong ones are in there too, but the correct one isn't "
            "highlighted. Grow by getting it right, shrink if you don't."
        ),
        "best_for": "Recall under pressure. Great for vocabulary, formulas, definitions.",
    },
]


# ---------- Adaptation Agent I/O ----------

class GameplayEvent(BaseModel):
    session_id: str
    concept_id: str
    question_id: str
    correct: bool
    hint_used: bool = False
    time_ms: int


class AdaptationSignal(BaseModel):
    action: Literal["raise_difficulty", "lower_difficulty",
                    "show_hint", "requeue_concept", "noop"]
    concept_id: str | None = None
    payload: dict = Field(default_factory=dict)


# ---------- Reporting Agent output ----------

class Report(BaseModel):
    report_id: str = Field(default_factory=lambda: f"rep_{uuid4().hex[:12]}")
    student_id: str
    lesson_id: str
    score: int = Field(ge=0, le=100)
    concepts_mastered: list[str]
    concepts_weak: list[str]
    time_seconds: int
    hints_used: int
    narrative: str
