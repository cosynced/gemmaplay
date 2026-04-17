"""Database engine and session management."""
from __future__ import annotations

from collections.abc import Generator

from sqlmodel import Session, SQLModel, create_engine

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

_settings = get_settings()
_engine = create_engine(
    _settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False}
    if _settings.database_url.startswith("sqlite") else {},
)


def init_db() -> None:
    """Create tables. Safe to call multiple times."""
    # Import models so SQLModel sees them
    from app.db import models  # noqa: F401
    SQLModel.metadata.create_all(_engine)
    log.info("db_initialized", url=_settings.database_url)


def get_session() -> Generator[Session, None, None]:
    with Session(_engine) as session:
        yield session
