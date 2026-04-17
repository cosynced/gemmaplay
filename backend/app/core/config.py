"""Application configuration loaded from environment variables."""
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Gemma
    gemma_provider: Literal["vertex", "google", "ollama"] = "vertex"
    gemma_api_key: str = ""
    gemma_model: str = "gemma-4-26b-a4b-it"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "gemma4:26b"

    # Vertex AI Model Garden (MaaS)
    gcp_project_id: str = ""
    gcp_region: str = "global"
    vertex_model_id: str = "gemma-4-26b-a4b-it-maas"

    # App
    app_env: str = "development"
    database_url: str = "sqlite:///./gemmaplay.db"
    storage_backend: Literal["local", "gcs"] = "local"
    gcs_bucket: str = ""
    cors_origins: str = "http://localhost:5173"
    log_level: str = "INFO"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
