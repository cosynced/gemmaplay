"""Analytics endpoints: teacher summary, per-lesson leaderboard + breakdown.

All queries are derived from existing rows — no new tables. Concept mastery
is read from the serialized Report payload (concepts_mastered /
concepts_weak lists stored on ReportRow.data).
"""
from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db.models import GameRow, LessonRow, ReportRow
from app.db.session import get_session
from app.services.analytics import get_user_activity

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/user/{username}/activity", response_model=list[dict])
async def user_activity(
    username: str,
    db: Session = Depends(get_session),
):
    """Merged feed of lessons this user created and sessions they played.
    Sorted newest first, capped at 50 items. Drives the dashboard's
    'Your activity' list."""
    return get_user_activity(db, username)


@router.get("/teacher/{teacher_username}/summary", response_model=dict)
async def teacher_summary(
    teacher_username: str,
    db: Session = Depends(get_session),
):
    games = db.exec(
        select(GameRow).where(GameRow.teacher_username == teacher_username)
    ).all()
    reports = db.exec(
        select(ReportRow).where(ReportRow.teacher_username == teacher_username)
    ).all()

    unique_students = {
        r.student_name for r in reports if r.student_name and r.student_name != "anon"
    }
    scores = [int(r.data.get("score") or 0) for r in reports]
    avg_score = round(sum(scores) / len(scores), 1) if scores else 0.0

    return {
        "teacher_username": teacher_username,
        "games_count": len(games),
        "plays_count": len(reports),
        "unique_students": len(unique_students),
        "avg_score": avg_score,
    }


@router.get("/lesson/{lesson_id}/leaderboard", response_model=list[dict])
async def lesson_leaderboard(
    lesson_id: str,
    db: Session = Depends(get_session),
):
    # Game type is on the Game row, not the Report row — pre-load the map.
    games = db.exec(
        select(GameRow).where(GameRow.lesson_id == lesson_id)
    ).all()
    game_type_by_id = {
        g.game_id: (g.data or {}).get("game_type", "") for g in games
    }

    reports = db.exec(
        select(ReportRow).where(ReportRow.lesson_id == lesson_id)
    ).all()

    entries = []
    for r in reports:
        data = r.data or {}
        # The session row also holds game_id; for the MVP we just look up
        # via any session row whose session_id matches the report. But
        # ReportRow itself doesn't store game_id, so we fall back by
        # matching against all games for this lesson — pick the most
        # common one if we can't disambiguate. Good enough for the
        # leaderboard display.
        game_type = ""
        if len(game_type_by_id) == 1:
            game_type = next(iter(game_type_by_id.values()))
        entries.append({
            "student_name": r.student_name,
            "score": int(data.get("score") or 0),
            "time_seconds": int(data.get("time_seconds") or 0),
            "hints_used": int(data.get("hints_used") or 0),
            "game_type": game_type,
            "completed_at": r.created_at.isoformat(),
        })

    entries.sort(key=lambda e: (-e["score"], e["time_seconds"]))
    return entries[:10]


@router.get("/lesson/{lesson_id}/breakdown", response_model=dict)
async def lesson_breakdown(
    lesson_id: str,
    db: Session = Depends(get_session),
):
    lesson_row = db.exec(
        select(LessonRow).where(LessonRow.lesson_id == lesson_id)
    ).first()
    if not lesson_row:
        raise HTTPException(404, "Lesson not found")

    concepts = {
        c["id"]: c.get("name", c["id"])
        for c in (lesson_row.data or {}).get("concepts", [])
    }

    reports = db.exec(
        select(ReportRow).where(ReportRow.lesson_id == lesson_id)
    ).all()

    mastered_counts: Counter = Counter()
    weak_counts: Counter = Counter()
    scores: list[int] = []
    for r in reports:
        data = r.data or {}
        scores.append(int(data.get("score") or 0))
        for cid in data.get("concepts_mastered") or []:
            mastered_counts[cid] += 1
        for cid in data.get("concepts_weak") or []:
            weak_counts[cid] += 1

    plays = len(reports) or 1  # avoid div-by-zero

    def rate(count: int) -> float:
        return round(count / plays, 2)

    most_mastered = [
        {
            "concept_id": cid,
            "name": concepts.get(cid, cid),
            "mastery_rate": rate(count),
        }
        for cid, count in mastered_counts.most_common(3)
    ]
    weakest = [
        {
            "concept_id": cid,
            "name": concepts.get(cid, cid),
            "mastery_rate": round(1 - (count / plays), 2),
        }
        for cid, count in weak_counts.most_common(3)
    ]

    return {
        "lesson_id": lesson_id,
        "plays_count": len(reports),
        "avg_score": round(sum(scores) / len(scores), 1) if scores else 0.0,
        "concepts_most_mastered": most_mastered,
        "concepts_weakest": weakest,
    }
