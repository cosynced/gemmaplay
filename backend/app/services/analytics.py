"""Analytics read-side helpers.

Currently holds `get_user_activity` for the merged "created + played"
dashboard feed. Queries touch `lessons`, `games`, `sessions`, and
`reports` — all additive reads, nothing persists here.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session, select

from app.db.models import GameRow, LessonRow, ReportRow, SessionRow

MAX_ACTIVITY_ITEMS = 50


def _normalize(dt: datetime) -> datetime:
    """Treat naive datetimes as UTC so we can compare them side-by-side
    with the timezone-aware ones emitted by SessionRow.started_at."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _total_questions(lesson_data: dict) -> int:
    total = 0
    for concept in (lesson_data or {}).get("concepts", []) or []:
        qs = concept.get("questions") if isinstance(concept, dict) else None
        if isinstance(qs, list):
            total += len(qs)
    return total


def get_user_activity(db: Session, username: str) -> list[dict]:
    """Merged feed of lessons this user created and sessions they played.

    Sorted newest first, capped at MAX_ACTIVITY_ITEMS. Anonymous plays
    (`student_name == "anon"`) are excluded by design — the `users` table
    disallows "anon" as a real username, so querying by a real username
    never matches them.
    """
    if not username or username == "anon":
        return []

    # ---- Created ----
    lessons = db.exec(
        select(LessonRow).where(LessonRow.teacher_username == username)
    ).all()

    entries: list[tuple[datetime, dict]] = []
    for lesson in lessons:
        entries.append((
            lesson.created_at,
            {
                "type": "created",
                "lesson_id": lesson.lesson_id,
                "lesson_title": lesson.title,
                "lesson_subject": lesson.subject or None,
                "timestamp": _normalize(lesson.created_at).isoformat(),
                "score": None,
                "total_questions": None,
                "game_type": None,
                "completed": False,
            },
        ))

    # ---- Played ----
    # Two overlapping buckets:
    #   1. sessions this user played themselves (student_name == username)
    #   2. sessions anyone played on a lesson this user owns
    #      (teacher_username == username and student_name != username)
    # Union-dedup on session_id so a creator self-play isn't double-counted.
    own_plays = db.exec(
        select(SessionRow).where(SessionRow.student_name == username)
    ).all()
    student_plays = db.exec(
        select(SessionRow).where(
            SessionRow.teacher_username == username,
            SessionRow.student_name != username,
        )
    ).all()
    seen_ids: set[str] = set()
    sessions: list[SessionRow] = []
    for s in list(own_plays) + list(student_plays):
        if s.session_id in seen_ids:
            continue
        seen_ids.add(s.session_id)
        sessions.append(s)

    # Cache game + lesson lookups so we don't N+1.
    game_cache: dict[str, GameRow] = {}
    lesson_cache: dict[str, LessonRow] = {}

    for s in sessions:
        game = game_cache.get(s.game_id)
        if game is None:
            game = db.exec(
                select(GameRow).where(GameRow.game_id == s.game_id)
            ).first()
            if game:
                game_cache[s.game_id] = game
        if not game:
            continue

        lesson = lesson_cache.get(game.lesson_id)
        if lesson is None:
            lesson = db.exec(
                select(LessonRow).where(LessonRow.lesson_id == game.lesson_id)
            ).first()
            if lesson:
                lesson_cache[game.lesson_id] = lesson
        if not lesson:
            continue

        report = db.exec(
            select(ReportRow).where(ReportRow.session_id == s.session_id)
        ).first()

        total_q = _total_questions(lesson.data or {})
        score = None
        if report:
            try:
                score = int((report.data or {}).get("score") or 0)
            except (TypeError, ValueError):
                score = None

        played_by_self = s.student_name == username
        entries.append((
            s.started_at,
            {
                "type": "played" if played_by_self else "student_played",
                "lesson_id": lesson.lesson_id,
                "lesson_title": lesson.title,
                "lesson_subject": lesson.subject or None,
                "timestamp": _normalize(s.started_at).isoformat(),
                "score": score,
                "total_questions": total_q or None,
                "game_type": (game.data or {}).get("game_type") or None,
                "completed": bool(report),
                "student_name": None if played_by_self else s.student_name,
            },
        ))

    entries.sort(key=lambda e: _normalize(e[0]), reverse=True)
    return [e[1] for e in entries[:MAX_ACTIVITY_ITEMS]]
