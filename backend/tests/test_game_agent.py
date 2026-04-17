"""Game agent is deterministic. These tests lock the level-ramping behavior."""
from app.agents.game_agent import GameAgent
from app.models.schemas import Concept, Lesson, Question


def _lesson(n_concepts: int = 3) -> Lesson:
    concepts = []
    for i in range(n_concepts):
        concepts.append(Concept(
            id=f"c{i}",
            name=f"Concept {i}",
            summary="Test",
            questions=[
                Question(q="q?", options=["a", "b", "c", "d"], answer_index=0)
            ],
        ))
    return Lesson(title="Test", concepts=concepts)


def test_one_level_per_concept():
    game = GameAgent().run(_lesson(4))
    assert len(game.levels) == 4


def test_difficulty_ramps_across_levels():
    game = GameAgent().run(_lesson(5))
    speeds = [lvl.base_speed for lvl in game.levels]
    assert speeds == sorted(speeds), "speed should be non-decreasing"
    assert speeds[-1] > speeds[0]


def test_default_game_type_is_lane_runner():
    game = GameAgent().run(_lesson())
    assert game.game_type == "lane_runner"


def test_game_type_is_respected():
    game = GameAgent().run(_lesson(), game_type="tetris_answer")
    assert game.game_type == "tetris_answer"
    game = GameAgent().run(_lesson(), game_type="quiz_runner")
    assert game.game_type == "quiz_runner"
