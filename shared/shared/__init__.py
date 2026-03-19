"""
Shared utilities for AddaxAI Connect services

This package provides common code shared across all microservices:
- Database models (SQLAlchemy)
- Database session management
- Redis queue client
- MinIO storage client
- Configuration loading
- Email template rendering
"""

from pathlib import Path


def _get_version() -> str:
    """Read version from VERSION file. Falls back to v0.0.0-dev."""
    paths = [
        Path("/app/VERSION"),
        Path(__file__).resolve().parents[2] / "VERSION",
    ]
    for path in paths:
        if path.exists():
            content = path.read_text().strip()
            if content:
                return content
    return "v0.0.0-dev"


__version__ = _get_version()
