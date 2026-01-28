"""
Shared utilities for AddaxAI Connect services

This package provides common code shared across all microservices:
- Database models (SQLAlchemy)
- Database session management
- Redis queue client
- MinIO storage client
- Configuration loading
"""

import os
from pathlib import Path

def _get_version() -> str:
    """
    Get version from multiple sources (priority order):
    1. VERSION file (created by Docker build from git tags)
    2. Git describe command (for local development)
    3. APP_VERSION environment variable
    4. Fallback to v0.0.0-dev

    Returns version in format:
    - Clean release: v0.2.1
    - Unreleased code: v0.2.1-5-g3a2b1c4 (5 commits after v0.2.1)
    - Development: v0.0.0-dev (no tags found)
    """
    # Try reading from VERSION file (Docker build)
    version_file = Path("/app/VERSION")
    if version_file.exists():
        try:
            return version_file.read_text().strip()
        except Exception:
            pass

    # Try git describe (local development)
    try:
        import subprocess
        version = subprocess.check_output(
            ["git", "describe", "--tags", "--always", "--dirty"],
            stderr=subprocess.DEVNULL,
            timeout=5
        ).decode().strip()
        if version:
            return version
    except Exception:
        pass

    # Try environment variable
    env_version = os.getenv("APP_VERSION")
    if env_version:
        return env_version

    # Final fallback
    return "v0.0.0-dev"

__version__ = _get_version()
