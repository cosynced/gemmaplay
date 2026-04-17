"""Gemma 4 client with Vertex AI, Google AI Studio, and Ollama backends.

Toggle via the GEMMA_PROVIDER env var:
  - "vertex"  → Vertex AI Model Garden Managed API Service (recommended for prod)
  - "google"  → Google AI Studio (fallback / hackathon demo)
  - "ollama"  → local Ollama instance (offline toggle / low-RAM fallback)

All paths return plain strings. JSON parsing / validation happens in the
calling agent using Pydantic schemas.
"""
from __future__ import annotations

import json
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


class GemmaClient:
    """Unified Gemma client. Chooses provider based on config."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.provider = self.settings.gemma_provider
        log.info("gemma_client_init", provider=self.provider,
                 model=self._model_name())

    def _model_name(self) -> str:
        if self.provider == "vertex":
            return self.settings.vertex_model_id
        if self.provider == "google":
            return self.settings.gemma_model
        return self.settings.ollama_model

    @retry(stop=stop_after_attempt(2),
           wait=wait_exponential(multiplier=1, min=1, max=4))
    async def generate(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.2,
        json_mode: bool = True,
    ) -> str:
        """Generate a completion. Returns raw text."""
        if self.provider == "vertex":
            return await self._call_vertex(prompt, system, temperature, json_mode)
        if self.provider == "google":
            return await self._call_google(prompt, system, temperature, json_mode)
        return await self._call_ollama(prompt, system, temperature, json_mode)

    async def generate_json(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        """Generate and parse JSON. Raises ValueError on invalid JSON."""
        text = await self.generate(prompt, system, temperature, json_mode=True)
        # Strip common code-fence wrappers that models like to add
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.rsplit("```", 1)[0]
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError as e:
            log.error("gemma_json_parse_failed", text=text[:500], error=str(e))
            raise ValueError(f"Gemma returned invalid JSON: {e}") from e

    # ---------- Provider implementations ----------

    async def _get_vertex_access_token(self) -> str:
        # Lazy import so dev environments without google-auth can still use
        # the AI Studio or Ollama providers.
        import google.auth
        from google.auth.transport.requests import Request

        creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
        creds.refresh(Request())
        return creds.token

    async def _call_vertex(
        self, prompt: str, system: str | None,
        temperature: float, json_mode: bool,
    ) -> str:
        """Vertex AI Model Garden MaaS via the OpenAI-compatible endpoint.

        Gemma 4 26B A4B IT MaaS is exposed through the openapi/chat/completions
        path, not :generateContent. Auth via ADC.
        """
        if not self.settings.gcp_project_id:
            raise RuntimeError("GCP_PROJECT_ID not set for vertex provider")

        region = self.settings.gcp_region
        project = self.settings.gcp_project_id
        model = self.settings.vertex_model_id
        url = (
            f"https://aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{region}/endpoints/openapi/chat/completions"
        )

        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        body: dict[str, Any] = {
            "model": f"google/{model}",
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 2048,
            "stream": False,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}

        token = await self._get_vertex_access_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, json=body, headers=headers)
            r.raise_for_status()
            data = r.json()

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            log.error("gemma_vertex_response_malformed", data=data)
            raise RuntimeError(f"Malformed Gemma response: {e}") from e

    async def _call_google(
        self, prompt: str, system: str | None,
        temperature: float, json_mode: bool,
    ) -> str:
        """Google AI Studio via the generativelanguage.googleapis.com endpoint.

        Uses a direct HTTP call to keep the dependency surface small.
        """
        if not self.settings.gemma_api_key:
            raise RuntimeError("GEMMA_API_KEY not set for google provider")

        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.settings.gemma_model}:generateContent"
            f"?key={self.settings.gemma_api_key}"
        )
        contents: list[dict] = []
        if system:
            contents.append({"role": "user", "parts": [{"text": system}]})
            contents.append({"role": "model",
                             "parts": [{"text": "Understood. I will follow these instructions."}]})
        contents.append({"role": "user", "parts": [{"text": prompt}]})

        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 2048,
            },
        }
        if json_mode:
            body["generationConfig"]["responseMimeType"] = "application/json"

        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(url, json=body)
            r.raise_for_status()
            data = r.json()

        try:
            return data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError) as e:
            log.error("gemma_google_response_malformed", data=data)
            raise RuntimeError(f"Malformed Gemma response: {e}") from e

    async def _call_ollama(
        self, prompt: str, system: str | None,
        temperature: float, json_mode: bool,
    ) -> str:
        """Local Ollama instance (offline toggle)."""
        url = f"{self.settings.ollama_base_url}/api/generate"
        body: dict[str, Any] = {
            "model": self.settings.ollama_model,
            "prompt": prompt,
            "system": system or "",
            "stream": False,
            "options": {"temperature": temperature},
        }
        if json_mode:
            body["format"] = "json"

        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(url, json=body)
            r.raise_for_status()
            return r.json().get("response", "")


_client: GemmaClient | None = None


def get_gemma_client() -> GemmaClient:
    global _client
    if _client is None:
        _client = GemmaClient()
    return _client
