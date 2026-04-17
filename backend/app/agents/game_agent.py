"""Game Agent: Lesson -> Game.

Deterministic template-based assembly. No LLM call — saves the Gemma budget
for agents that actually need generation (see DEV_GUIDE Section 4).
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.models.schemas import Game, GameTypeId, Level, Lesson

log = get_logger(__name__)


class GameAgent:
    """Converts a Lesson into a playable Game.

    The levels array is the same shape for every game_type — each frontend
    scene interprets it as its own mechanic (lanes, bins, blaster waves, …).
    """

    def run(self, lesson: Lesson, game_type: GameTypeId = "lane_runner") -> Game:
        log.info(
            "game_agent_start", lesson_id=lesson.lesson_id, game_type=game_type,
        )

        levels: list[Level] = []
        for idx, concept in enumerate(lesson.concepts):
            # Ramp difficulty across levels: later levels are faster/denser
            ramp = idx / max(len(lesson.concepts) - 1, 1)  # 0.0 -> 1.0
            level = Level(
                level_id=f"l{idx + 1}",
                concept_id=concept.id,
                target_distance=1000 + int(ramp * 500),
                base_speed=200 + int(ramp * 80),
                obstacle_density=round(0.25 + ramp * 0.2, 2),
                questions=[q.id for q in concept.questions],
            )
            levels.append(level)

        game = Game(
            lesson_id=lesson.lesson_id, game_type=game_type, levels=levels,
        )
        log.info(
            "game_agent_done",
            game_id=game.game_id,
            game_type=game.game_type,
            levels=len(levels),
        )
        return game
