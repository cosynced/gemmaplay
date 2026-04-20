"""Database engine and session management."""
from __future__ import annotations
from collections.abc import Generator
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine
from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)
_settings = get_settings()

_is_sqlite = _settings.database_url.startswith("sqlite")

_engine = create_engine(
    _settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 30} if _is_sqlite else {},
    pool_pre_ping=True,
)


@event.listens_for(Engine, "connect")
def _apply_sqlite_pragmas(dbapi_connection, connection_record):
    if not _is_sqlite:
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def _sqlite_add_missing_columns() -> None:
    """Add any model columns that aren't in the SQLite table yet.

    SQLModel.metadata.create_all() only creates missing tables, not missing
    columns. This is an intentionally-tiny additive migration: read each
    table's pragma_table_info, compare to the model, ALTER TABLE ADD COLUMN
    for anything new (with its DEFAULT). Destructive changes (drops, type
    changes) aren't handled — reach for Alembic when that day comes.
    """
    if not _is_sqlite:
        return
    from app.db import models  # noqa: F401
    from app.db import user_models  # noqa: F401
    from sqlalchemy import inspect, text
    insp = inspect(_engine)
    with _engine.begin() as conn:
        for table_name, table in SQLModel.metadata.tables.items():
            if not insp.has_table(table_name):
                continue
            existing = {c["name"] for c in insp.get_columns(table_name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl_type = col.type.compile(_engine.dialect)
                default_sql = ""
                if col.default is not None and getattr(col.default, "is_scalar", False):
                    val = col.default.arg
                    if isinstance(val, (int, float)):
                        default_sql = f" DEFAULT {val}"
                    elif isinstance(val, str):
                        default_sql = f" DEFAULT '{val}'"
                conn.execute(text(
                    f'ALTER TABLE "{table_name}" ADD COLUMN "{col.name}" {ddl_type}{default_sql}'
                ))
                log.info("db_added_column", table=table_name, column=col.name)


def init_db() -> None:
    """Create tables. Safe to call multiple times."""
    from app.db import models  # noqa: F401
    from app.db import user_models  # noqa: F401
    SQLModel.metadata.create_all(_engine)
    _sqlite_add_missing_columns()
    log.info("db_initialized", url=_settings.database_url)


def get_session() -> Generator[Session, None, None]:
    with Session(_engine) as session:
        yield session
