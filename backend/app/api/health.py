"""Health and readiness probes (used by Cloud Run)."""
from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz():
    return {"status": "ok"}


@router.get("/readyz")
async def readyz():
    s = get_settings()
    return {
        "status": "ready",
        "gemma_provider": s.gemma_provider,
        "storage_backend": s.storage_backend,
        "env": s.app_env,
    }
