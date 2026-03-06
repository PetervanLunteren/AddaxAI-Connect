"""
Root conftest for AddaxAI-Connect tests.

Sets environment variables BEFORE any service code is imported,
because shared/queue.py, shared/storage.py, and shared/database.py
all call get_settings() at module level.
"""
import os
import sys

# Environment variables required by shared.config.Settings
os.environ.update({
    "DATABASE_URL": "postgresql://test:test@localhost:5432/test",
    "REDIS_URL": "redis://localhost:6379/0",
    "MINIO_ENDPOINT": "localhost:9000",
    "MINIO_ACCESS_KEY": "minioadmin",
    "MINIO_SECRET_KEY": "minioadmin",
    "LOG_LEVEL": "WARNING",
    "LOG_FORMAT": "text",
    "ENVIRONMENT": "test",
})

# Add shared library to sys.path so `from shared.config import ...` works
# even when the package isn't pip-installed
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHARED_SRC = os.path.join(REPO_ROOT, "shared")
if SHARED_SRC not in sys.path:
    sys.path.insert(0, SHARED_SRC)
