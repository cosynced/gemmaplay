"""User account rows. Minimal: username (display + id) + bcrypt PIN hash."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class UserRow(SQLModel, table=True):
    __tablename__ = "users"

    username: str = Field(primary_key=True, max_length=24)
    pin_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_sign_in: Optional[datetime] = None
