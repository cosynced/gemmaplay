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
    data: dict = Field(sa_column=Column(JSON))  # serialized Lesson
    created_at: datetime = Field(default_factory=datetime.utcnow)


class GameRow(SQLModel, table=True):
    __tablename__ = "games"
    id: Optional[int] = Field(default=None, primary_key=True)
    game_id: str = Field(index=True, unique=True)
    lesson_id: str = Field(index=True, foreign_key="lessons.lesson_id")
    data: dict = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SessionRow(SQLModel, table=True):
    __tablename__ = "sessions"
    id: Optional[int] = Field(default=None, primary_key=True)
    session_id: str = Field(index=True, unique=True)
    game_id: str = Field(index=True)
    student_id: str = Field(index=True)
    started_at: datetime = Field(default_factory=datetime.utcnow)
    ended_at: Optional[datetime] = None
    events: list = Field(default_factory=list, sa_column=Column(JSON))


class ReportRow(SQLModel, table=True):
    __tablename__ = "reports"
    id: Optional[int] = Field(default=None, primary_key=True)
    report_id: str = Field(index=True, unique=True)
    session_id: str = Field(index=True)
    student_id: str = Field(index=True)
    lesson_id: str = Field(index=True)
    data: dict = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)
