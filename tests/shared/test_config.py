"""Tests for shared.config.Settings validation."""
import os
import pytest
from shared.config import Settings


class TestSettings:
    """Verify Settings loads from environment variables."""

    def test_loads_from_env(self):
        """Settings() succeeds when required env vars are set (via conftest)."""
        s = Settings()
        assert s.database_url == "postgresql://test:test@localhost:5432/test"
        assert s.redis_url == "redis://localhost:6379/0"

    def test_optional_fields_default_to_none(self):
        """Optional fields have sensible defaults."""
        s = Settings()
        assert s.jwt_secret is None
        assert s.mail_server is None
        assert s.demo_mode is False

    def test_minio_fields(self):
        """MinIO fields are loaded correctly."""
        s = Settings()
        assert s.minio_endpoint == "localhost:9000"
        assert s.minio_access_key == "minioadmin"
        assert s.minio_secret_key == "minioadmin"
        assert s.minio_secure is False

    def test_missing_required_field_raises(self, monkeypatch):
        """Missing a required field raises a validation error."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        with pytest.raises(Exception):
            Settings()
