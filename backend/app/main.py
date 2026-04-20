"""FastAPI application entry point."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api import analytics, auth, health, lessons, sessions
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.rate_limit import limiter
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

# Rate limiting: per-IP via slowapi. Routes opt in with @limiter.limit(...).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=600,
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(lessons.router)
app.include_router(sessions.router)
app.include_router(analytics.router)


@app.get("/")
async def root():
    return {
        "service": "gemmaplay",
        "version": "0.1.0",
        "docs": "/docs",
    }
