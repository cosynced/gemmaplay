# Gemma 4 Setup

GemmaPlay supports three Gemma providers, switchable by a single env var:

| Provider | Use case | Env value |
|----------|----------|-----------|
| **Vertex AI Model Garden (MaaS)** | **Recommended — prod & demo** | `GEMMA_PROVIDER=vertex` |
| Google AI Studio | Fallback if you can't use GCP | `GEMMA_PROVIDER=google` |
| Ollama (local)   | Offline / on-device pitch     | `GEMMA_PROVIDER=ollama` |

## Why Gemma 4 26B A4B IT

We target `gemma-4-26b-a4b-it-maas` on Vertex AI:

- **Mixture-of-Experts**: 25.2B total parameters, but only ~3.8B active per
  token. You pay the quality of a 26B model at the latency/cost of a ~4B.
- **256K context window** — plenty of room for lesson PDFs plus the full
  adaptive session transcript.
- **Multimodal** (text + vision) — leaves room to extend GemmaPlay beyond PDFs.
- **Apache 2.0 license** — we can self-host the same weights on Ollama as a
  fallback without licensing friction.
- **Strong structured-output behavior** with `responseMimeType:
  application/json`, which is what every agent in this repo expects.

## Option 1 — Vertex AI Model Garden (recommended)

Vertex MaaS is pay-per-token, auto-scaled, and authenticates via GCP IAM —
no API keys to rotate.

### One-time GCP setup

1. Create (or pick) a GCP project and **enable billing**. Vertex MaaS needs
   an active billing account even at pennies-per-day usage.
2. Run the bootstrap script — it enables the APIs, creates the GCS bucket,
   and grants `roles/aiplatform.user` to the Cloud Run service account:

   ```bash
   export PROJECT_ID=your-gcp-project
   export REGION=us-central1
   ./scripts/gcp_bootstrap.sh
   ```

### Local dev auth (Application Default Credentials)

No API key. The backend reads ADC via `google.auth.default()`:

```bash
gcloud auth application-default login
```

This writes credentials to `~/.config/gcloud/application_default_credentials.json`
and the backend picks them up automatically.

### Configuring the backend

Put this in `backend/.env`:

```
GEMMA_PROVIDER=vertex
GCP_PROJECT_ID=your-gcp-project
GCP_REGION=us-central1
VERTEX_MODEL_ID=gemma-4-26b-a4b-it-maas
```

### Verifying

```bash
curl -s http://localhost:8000/readyz
# {"status":"ready","gemma_provider":"vertex",...}
```

Upload a test lesson:

```bash
curl -X POST http://localhost:8000/api/lessons \
  -F "file=@sample.pdf"
```

If the lesson upload succeeds, Vertex is wired up correctly.

### Pricing

Gemma MaaS pricing runs roughly **$0.07 / M input tokens** and
**$0.40 / M output tokens** (check the current Vertex pricing page — rates
move). A full hackathon day of usage is measured in cents, not dollars.

## Option 2 — Google AI Studio (fallback)

Use this if you can't spin up GCP (e.g. no billing account) but can still
hit the public generative endpoint.

1. Grab a key at https://aistudio.google.com/apikey
2. `backend/.env`:

   ```
   GEMMA_PROVIDER=google
   GEMMA_API_KEY=your_key_here
   GEMMA_MODEL=gemma-4-26b-a4b-it
   ```

3. Restart. `/readyz` reports `"gemma_provider": "google"`.

The client calls
`generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
directly with the key as a query param. Same JSON-mode behavior as the
Vertex path.

## Option 3 — Ollama (offline / on-device)

Use this for the on-device story or any time you're on a flight.

1. Install Ollama: https://ollama.com/download
2. Pull Gemma 4:

   ```bash
   ./scripts/ollama_setup.sh
   ```

3. `backend/.env`:

   ```
   GEMMA_PROVIDER=ollama
   OLLAMA_BASE_URL=http://localhost:11434
   OLLAMA_MODEL=gemma4:26b
   ```

4. Restart. `/readyz` reports `"gemma_provider": "ollama"`.

### Hardware notes

- `gemma4:26b` needs roughly **16 GB of VRAM** (or unified memory on
  Apple silicon). Fine on an M2 Pro / M3 / M4.
- On lower-end laptops, pull `gemma4:e4b` instead — the small MoE variant
  runs comfortably in 8 GB. Update `OLLAMA_MODEL` to match.
- First inference is slow while the model loads. Send a dummy request at
  startup to warm it up.

## Switching providers at runtime

Not supported. Provider is baked in at startup via the `@lru_cache` on
`get_settings`. Restart the backend to switch.

## Troubleshooting

### `google.auth.exceptions.DefaultCredentialsError`

ADC isn't configured. Run `gcloud auth application-default login` (local) or
make sure the Cloud Run service has an attached service account with
`roles/aiplatform.user` (prod). On Cloud Run, the metadata server supplies
the credentials automatically — you shouldn't need a key file.

### `403 PERMISSION_DENIED`

The caller lacks `roles/aiplatform.user` on the project, or the Vertex AI
API isn't enabled. Re-run `scripts/gcp_bootstrap.sh`, or manually:

```bash
gcloud services enable aiplatform.googleapis.com
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="user:$(gcloud config get-value account)" \
  --role=roles/aiplatform.user --condition=None
```

### `404 Publisher Model ... was not found`

Either the model ID is wrong or it isn't available in your region. Confirm
`VERTEX_MODEL_ID=gemma-4-26b-a4b-it-maas` exactly, and that
`GCP_REGION=us-central1` (the Gemma MaaS launch region). Some Gemma
variants are regional.

### `429 RESOURCE_EXHAUSTED` / quota errors

You hit the default per-minute quota. File a quota bump request in the
Vertex AI → Quotas console for "Online prediction requests per minute" on
the Gemma publisher model. Until then, the `@retry` decorator will absorb
short bursts.

### Cold-start latency

First request after idle can take 5–15 seconds as the MaaS endpoint warms.
It's a MaaS characteristic, not a bug. For demos, send a throwaway request
at service startup (or ahead of the demo) to pre-warm.

### Upload works but lesson extraction is empty

Almost always JSON parsing. Check the backend logs for
`gemma_json_parse_failed` — the raw text is logged (first 500 chars). If
Gemma returned prose instead of JSON, check that `responseMimeType` is
being sent (it is, for `json_mode=True`). If you're on the Ollama path,
make sure you're on `gemma4:26b` or `gemma4:e4b`, not an older tag.
