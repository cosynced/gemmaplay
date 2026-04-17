"""PDF and text extraction utilities."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pdfplumber


def extract_text(file_path: Path) -> str:
    """Extract text from PDF or plain text file.

    For MVP we only support text-based PDFs. Scanned PDFs are a post-hackathon
    problem (see DEV_GUIDE Section 10).
    """
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf(file_path)
    if suffix in {".txt", ".md"}:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    raise ValueError(f"Unsupported file type: {suffix}")


def _extract_pdf(file_path: Path) -> str:
    parts: list[str] = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                parts.append(text)
    return "\n\n".join(parts)


def text_hash(text: str) -> str:
    """Stable hash for caching lesson extraction results."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
