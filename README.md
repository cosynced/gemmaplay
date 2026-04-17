# GemmaPlay

**Any lesson, any classroom, playable in 60 seconds.**

AI-powered platform that turns lesson materials into adaptive 2D learning games. Built on Gemma 4 for the Kaggle Gemma 4 Good Hackathon (deadline May 18, 2026).

## Quick Start

```bash
# 1. Clone and enter
cd gemmaplay

# 2. Backend
cd backend
cp .env.example .env   # fill in GEMMA_API_KEY for online mode
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and start uploading lessons.

## Documentation

- [Development Guide](docs/DEV_GUIDE.md) — read this first, it answers almost everything
- [Architecture](docs/ARCHITECTURE.md) — system diagram, data flow, agent contracts
- [Gemma Setup](docs/GEMMA_SETUP.md) — online (Google AI Studio) vs offline (Ollama) toggle
- [GCP Deployment](docs/DEPLOYMENT.md) — Cloud Run + Cloud Storage setup
- [Demo Script](docs/DEMO_SCRIPT.md) — 90-second submission video script

## Stack

- **Backend:** Python 3.11, FastAPI, SQLite (MVP) → Cloud SQL (prod)
- **Frontend:** React 18 + Vite + Phaser 3
- **Model:** Gemma 4 — online via Google AI Studio / Vertex AI, offline via Ollama
- **Hosting:** Google Cloud Run (backend) + Cloud Storage + Firebase Hosting (frontend)

## Project Layout

```
gemmaplay/
├── backend/          FastAPI service, four agents, Gemma client
├── frontend/         React shell + Phaser game
├── docs/             Dev guide, architecture, deployment, demo script
├── scripts/          Setup and deployment helpers
├── infra/            Cloud Run service YAML, Dockerfiles
└── .github/          CI workflows
```

## License

MIT
