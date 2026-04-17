.PHONY: help setup backend frontend test deploy clean

help:
	@echo "GemmaPlay dev commands:"
	@echo "  make setup       Install backend + frontend deps"
	@echo "  make backend     Run backend (port 8000)"
	@echo "  make frontend    Run frontend (port 5173)"
	@echo "  make test        Run backend unit tests"
	@echo "  make deploy      Deploy backend to Cloud Run"
	@echo "  make clean       Remove build artifacts and caches"

setup:
	./scripts/dev_bootstrap.sh

backend:
	cd backend && . .venv/bin/activate && uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

test:
	cd backend && . .venv/bin/activate && python -m pytest tests/ -v

deploy:
	gcloud builds submit --config=infra/cloudbuild.yaml .

clean:
	rm -rf backend/.venv backend/__pycache__ backend/**/__pycache__
	rm -rf backend/.pytest_cache backend/*.db
	rm -rf frontend/node_modules frontend/dist frontend/.vite
