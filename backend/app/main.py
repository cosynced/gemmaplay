"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, lessons, sessions
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.session import init_db

configure_logging()
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    log.info("app_start", env=settings.app_env, provider=settings.gemma_provider)
    init_db()
    yield
    log.info("app_stop")


settings = get_settings()

app = FastAPI(
    title="GemmaPlay API",
    description="Lesson -> adaptive game -> teacher report. Powered by Gemma 4.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(lessons.router)
app.include_router(sessions.router)


@app.get("/")
async def root():
    return {
        "service": "gemmaplay",
        "version": "0.1.0",
        "docs": "/docs",
    }
