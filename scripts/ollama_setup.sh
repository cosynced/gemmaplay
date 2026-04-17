#!/usr/bin/env bash
# Pull Gemma 4 via Ollama for offline mode.
# Run this once, then set GEMMA_PROVIDER=ollama in backend/.env.
set -euo pipefail

if ! command -v ollama >/dev/null; then
  echo "Ollama is not installed. Get it from https://ollama.com/download"
  exit 1
fi

MODEL="${OLLAMA_MODEL:-gemma4:9b}"

echo "==> Pulling $MODEL (this can take a while on first run)"
ollama pull "$MODEL"

echo "==> Warming up the model"
ollama run "$MODEL" "Reply with the word ready." --verbose 2>/dev/null | head -1 || true

echo ""
echo "✓ Ollama is ready with $MODEL."
echo ""
echo "To switch the backend to offline mode:"
echo "  1. Edit backend/.env: GEMMA_PROVIDER=ollama"
echo "  2. Restart the backend"
