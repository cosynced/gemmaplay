"""Activity feed must surface student plays of the teacher's own lessons,
not just the teacher's self-plays. Regression test for the bug where
student sessions were invisible to the creator's dashboard."""
from datetime import datetime, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import GameRow, LessonRow, ReportRow, SessionRow
from app.services.analytics import get_user_activity


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


def _seed_lesson(db: Session, *, lesson_id: str, teacher: str) -> None:
    db.add(LessonRow(
        lesson_id=lesson_id,
        title=f"Lesson {lesson_id}",
        subject="math",
        grade_level="6",
        teacher_username=teacher,
        data={"concepts": [{"id": "c1", "questions": [{}, {}, {}]}]},
    ))
    db.add(GameRow(
        game_id=f"g_{lesson_id}",
        lesson_id=lesson_id,
        teacher_username=teacher,
        data={"game_type": "lane_runner"},
    ))
    db.commit()


def _seed_session(
    db: Session, *, session_id: str, game_id: str,
    student_name: str, teacher: str, started_at: datetime,
) -> None:
    db.add(SessionRow(
        session_id=session_id,
        game_id=game_id,
        student_id="demo",
        student_name=student_name,
        teacher_username=teacher,
        started_at=started_at,
    ))
    db.commit()


def test_activity_includes_student_plays_on_own_lessons(db: Session):
    _seed_lesson(db, lesson_id="L1", teacher="creator_test")
    _seed_session(
        db, session_id="s1", game_id="g_L1",
        student_name="alice", teacher="creator_test",
        started_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
    )

    feed = get_user_activity(db, "creator_test")

    plays = [e for e in feed if e["type"] == "student_played"]
    assert len(plays) == 1
    assert plays[0]["student_name"] == "alice"
    assert plays[0]["lesson_id"] == "L1"


def test_activity_still_includes_self_plays(db: Session):
    _seed_lesson(db, lesson_id="L1", teacher="creator_test")
    _seed_session(
        db, session_id="s1", game_id="g_L1",
        student_name="creator_test", teacher="creator_test",
        started_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
    )

    feed = get_user_activity(db, "creator_test")

    self_plays = [e for e in feed if e["type"] == "played"]
    assert len(self_plays) == 1
    # The self-play must NOT also appear as a student_played entry.
    assert not [e for e in feed if e["type"] == "student_played"]


def test_activity_omits_other_teachers_lessons(db: Session):
    _seed_lesson(db, lesson_id="L1", teacher="someone_else")
    _seed_session(
        db, session_id="s1", game_id="g_L1",
        student_name="alice", teacher="someone_else",
        started_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
    )

    feed = get_user_activity(db, "creator_test")
    assert feed == []


def test_activity_completed_flag_tracks_report(db: Session):
    _seed_lesson(db, lesson_id="L1", teacher="creator_test")
    _seed_session(
        db, session_id="s1", game_id="g_L1",
        student_name="alice", teacher="creator_test",
        started_at=datetime(2026, 4, 20, 12, 0, tzinfo=timezone.utc),
    )
    db.add(ReportRow(
        report_id="r1",
        session_id="s1",
        student_id="demo",
        student_name="alice",
        teacher_username="creator_test",
        lesson_id="L1",
        data={"score": 42},
    ))
    db.commit()

    feed = get_user_activity(db, "creator_test")
    play = next(e for e in feed if e["type"] == "student_played")
    assert play["completed"] is True
    assert play["score"] == 42
