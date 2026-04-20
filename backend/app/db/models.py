"""SQLModel ORM definitions.

SQLite for MVP (zero setup). Swap to Cloud SQL Postgres later by just
changing DATABASE_URL — SQLModel/SQLAlchemy handle the rest.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class LessonRow(SQLModel, table=True):
    __tablename__ = "lessons"
    id: Optional[int] = Field(default=None, primary_key=True)
    lesson_id: str = Field(index=True, unique=True)
    title: str
    subject: str
    grade_level: str
    teacher_username: str = Field(default="anon", index=True)
    data: dict = Field(sa_column=Column(JSON))  # serialized Lesson
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GameRow(SQLModel, table=True):
    __tablename__ = "games"
    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: str = Field(index=True, unique=True)
    lesson_id: str = Field(index=True, foreign_key="lessons.lesson_id")
    teacher_username: str = Field(default="anon", index=True)
    data: dict = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SessionRow(SQLModel, table=True):
    __tablename__ = "sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True, unique=True)
    game_id: str = Field(index=True)
    student_id: str = Field(index=True)
    student_name: str = Field(default="anon")
    teacher_username: str = Field(default="anon", index=True)
    client_ip: str = Field(default="")
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    events: list = Field(default_factory=list, sa_column=Column(JSON))
    # Infinite-game run stats. All default to 0 so pre-existing rows still load.
    score: int = Field(default=0)
    questions_answered: int = Field(default=0)
    questions_correct: int = Field(default=0)
    max_streak: int = Field(default=0)
    time_seconds: int = Field(default=0)


class ReportRow(SQLModel, table=True):
    __tablename__ = "reports"
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: str = Field(index=True, unique=True)
    session_id: str = Field(index=True)
    student_id: str = Field(index=True)
    student_name: str = Field(default="anon")
    teacher_username: str = Field(default="anon", index=True)
    client_ip: str = Field(default="")
    lesson_id: str = Field(index=True)
    data: dict = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # Denormalized for analytics queries — mirrors SessionRow fields.
    score: int = Field(default=0)
    questions_answered: int = Field(default=0)
    questions_correct: int = Field(default=0)
    max_streak: int = Field(default=0)
    time_seconds: int = Field(default=0)
