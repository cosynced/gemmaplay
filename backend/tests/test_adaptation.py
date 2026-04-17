"""Adaptation agent rules are the hot path of gameplay. Lock them with tests."""
from app.agents.adaptation_agent import AdaptationAgent
from app.models.schemas import GameplayEvent


def _event(correct: bool, session_id="s1", concept_id="c1", hint_used=False):
    return GameplayEvent(
        session_id=session_id,
        concept_id=concept_id,
        question_id="q1",
        correct=correct,
        hint_used=hint_used,
        time_ms=1000,
    )


def test_noop_on_single_correct():
    a = AdaptationAgent()
    sig = a.process(_event(True))
    assert sig.action == "noop"


def test_hint_fires_after_two_wrong_in_a_row():
    a = AdaptationAgent()
    a.process(_event(False))
    sig = a.process(_event(False))
    assert sig.action == "show_hint"
    assert sig.payload["reduce_options_to"] == 2


def test_raise_difficulty_after_two_correct_streak():
    a = AdaptationAgent()
    a.process(_event(True))
    sig = a.process(_event(True))
    assert sig.action == "raise_difficulty"


def test_wrong_streak_resets_on_correct():
    a = AdaptationAgent()
    a.process(_event(False))
    a.process(_event(True))
    sig = a.process(_event(False))
    assert sig.action == "noop"  # streak reset


def test_concepts_are_tracked_separately():
    a = AdaptationAgent()
    a.process(_event(False, concept_id="c1"))
    a.process(_event(False, concept_id="c2"))
    # Neither concept has hit the threshold alone
    sig = a.process(_event(False, concept_id="c1"))
    assert sig.action == "show_hint"
    assert sig.concept_id == "c1"
