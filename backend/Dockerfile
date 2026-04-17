# Backend image for Cloud Run.
# Uses Python 3.11 slim, installs deps, runs uvicorn on $PORT.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps for pdfplumber (needs ghostscript for some PDFs but not strictly required)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run injects PORT (default 8080). Honor it.
ENV PORT=8080
EXPOSE 8080

# Start with a single worker; Cloud Run handles horizontal scaling.
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1
