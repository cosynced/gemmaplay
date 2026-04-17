"""Storage abstraction: local filesystem for dev, GCS for Cloud Run.

Swap implementations via STORAGE_BACKEND env var. The interface is intentionally
tiny — we only need save / load bytes by key.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class StorageBackend(ABC):
    @abstractmethod
    async def save(self, key: str, data: bytes) -> str:
        """Save bytes and return a retrievable URI."""

    @abstractmethod
    async def load(self, key: str) -> bytes:
        """Load bytes by key."""


class LocalStorage(StorageBackend):
    def __init__(self, root: str = "./uploads") -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    async def save(self, key: str, data: bytes) -> str:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

    async def load(self, key: str) -> bytes:
        return (self.root / key).read_bytes()


class GCSStorage(StorageBackend):
    """Google Cloud Storage backend. Lazy import so dev doesn't need gcloud libs."""

    def __init__(self, bucket_name: str) -> None:
        from google.cloud import storage  # type: ignore
        self.client = storage.Client()
        self.bucket = self.client.bucket(bucket_name)
        self.bucket_name = bucket_name

    async def save(self, key: str, data: bytes) -> str:
        blob = self.bucket.blob(key)
        blob.upload_from_string(data)
        return f"gs://{self.bucket_name}/{key}"

    async def load(self, key: str) -> bytes:
        blob = self.bucket.blob(key)
        return blob.download_as_bytes()


_backend: StorageBackend | None = None


def get_storage() -> StorageBackend:
    global _backend
    if _backend is not None:
        return _backend

    settings = get_settings()
    if settings.storage_backend == "gcs":
        if not settings.gcs_bucket:
            raise RuntimeError("GCS_BUCKET must be set when STORAGE_BACKEND=gcs")
        _backend = GCSStorage(settings.gcs_bucket)
    else:
        _backend = LocalStorage()
    log.info("storage_backend_init", backend=settings.storage_backend)
    return _backend
