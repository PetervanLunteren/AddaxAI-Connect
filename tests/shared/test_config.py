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

    def test_optional_fields_default_to_none(self, monkeypatch):
        """Optional fields have sensible defaults when unset. The root
        conftest sets JWT_SECRET for router imports, so clear it here."""
        monkeypatch.delenv("JWT_SECRET", raising=False)
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


class TestCorsOriginList:
    """CORS_ORIGINS becomes a clean list, and unset means no origins at all."""

    @pytest.mark.parametrize("raw, expected", [
        (None, []),
        ("", []),
        ("https://a.example", ["https://a.example"]),
        ("https://a.example,https://b.example", ["https://a.example", "https://b.example"]),
        (" https://a.example , https://b.example ", ["https://a.example", "https://b.example"]),
        ("https://a.example,", ["https://a.example"]),
    ])
    def test_parsing(self, monkeypatch, raw, expected):
        if raw is None:
            monkeypatch.delenv("CORS_ORIGINS", raising=False)
        else:
            monkeypatch.setenv("CORS_ORIGINS", raw)
        assert Settings().cors_origin_list == expected

    def test_never_a_wildcard_when_unset(self, monkeypatch):
        monkeypatch.delenv("CORS_ORIGINS", raising=False)
        assert "*" not in Settings().cors_origin_list
