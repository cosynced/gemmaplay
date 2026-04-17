"""Adaptation Agent: real-time difficulty adjustment.

RULE-BASED, not LLM-based. Latency matters here — the game loop needs instant
responses. See DEV_GUIDE Section 3.3 for the rule set.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.core.logging import get_logger
from app.models.schemas import AdaptationSignal, GameplayEvent

log = get_logger(__name__)


@dataclass
class ConceptState:
    wrong_streak: int = 0
    correct_streak: int = 0
    total_correct: int = 0
    total_wrong: int = 0
    hints: int = 0


@dataclass
class SessionState:
    session_id: str
    concepts: dict[str, ConceptState] = field(
        default_factory=lambda: defaultdict(ConceptState)
    )
    events: list[GameplayEvent] = field(default_factory=list)


class AdaptationAgent:
    """Applies the rule set defined in DEV_GUIDE Section 3.3."""

    WRONG_THRESHOLD = 2
    CORRECT_THRESHOLD = 2

    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def session(self, session_id: str) -> SessionState:
        if session_id not in self._sessions:
            self._sessions[session_id] = SessionState(session_id=session_id)
        return self._sessions[session_id]

    def process(self, event: GameplayEvent) -> AdaptationSignal:
        state = self.session(event.session_id)
        state.events.append(event)
        c = state.concepts[event.concept_id]

        if event.hint_used:
            c.hints += 1

        if event.correct:
            c.total_correct += 1
            c.correct_streak += 1
            c.wrong_streak = 0
            if c.correct_streak >= self.CORRECT_THRESHOLD:
                c.correct_streak = 0
                return AdaptationSignal(
                    action="raise_difficulty",
                    concept_id=event.concept_id,
                    payload={"speed_mult": 1.1, "density_mult": 1.2},
                )
        else:
            c.total_wrong += 1
            c.wrong_streak += 1
            c.correct_streak = 0
            if c.wrong_streak >= self.WRONG_THRESHOLD:
                c.wrong_streak = 0
                return AdaptationSignal(
                    action="show_hint",
                    concept_id=event.concept_id,
                    payload={"reduce_options_to": 2},
                )

        return AdaptationSignal(action="noop", concept_id=event.concept_id)

    def session_summary(self, session_id: str) -> dict:
        state = self.session(session_id)
        return {
            "session_id": session_id,
            "event_count": len(state.events),
            "per_concept": {
                cid: {
                    "correct": c.total_correct,
                    "wrong": c.total_wrong,
                    "hints": c.hints,
                } for cid, c in state.concepts.items()
            },
        }
