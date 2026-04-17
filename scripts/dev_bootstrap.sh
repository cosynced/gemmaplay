#!/usr/bin/env bash
# Set up a local dev environment in one command.
# Usage: ./scripts/dev_bootstrap.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Backend setup"
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
echo "    Backend ready. Edit backend/.env to add GEMMA_API_KEY."

echo "==> Frontend setup"
cd "$ROOT/frontend"
if ! command -v npm >/dev/null; then
  echo "npm is required. Install Node.js 18+ and re-run."
  exit 1
fi
npm install
[ -f .env ] || cp .env.example .env

echo ""
echo "✓ Local dev ready."
echo ""
echo "Run backend:   cd backend && source .venv/bin/activate && uvicorn app.main:app --reload --port 8000"
echo "Run frontend:  cd frontend && npm run dev"
