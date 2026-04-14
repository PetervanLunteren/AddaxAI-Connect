"""
Tests for captured_at semantics: EXIF parsing, INSTAR path parsing, and the
EXIF OffsetTimeOriginal disagreement warning.
"""
import logging
import sys
import types
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from camera_profiles import parse_instar_path
from exif_parser import (
    _parse_exif_offset,
    check_exif_offset,
    get_datetime_original,
)
from utils import format_datetime_exif


def _install_fake_db_operations(monkeypatch, tz_name: str = "UTC"):
    """
    Replace the db_operations module in sys.modules with a stub that returns
    the requested timezone. Prevents check_exif_offset's lazy import from
    pulling in shared.database (which needs a live asyncpg driver).
    """
    fake = types.ModuleType("db_operations")
    fake.get_server_timezone = lambda: ZoneInfo(tz_name)
    monkeypatch.setitem(sys.modules, "db_operations", fake)
    return fake


class _RecordCollector(logging.Handler):
    """Captures emitted records for direct assertion."""

    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)

    @property
    def messages(self) -> list[str]:
        return [r.getMessage() for r in self.records]


@pytest.fixture
def ingestion_log(monkeypatch) -> _RecordCollector:
    """
    Attach a capturing handler directly to the "ingestion" logger. The
    shared logger's own StreamHandler grabs sys.stdout at import time, which
    sidesteps pytest's capsys, so a direct handler is the reliable route.
    """
    collector = _RecordCollector()
    logger = logging.getLogger("ingestion")
    logger.addHandler(collector)
    yield collector
    logger.removeHandler(collector)


class TestFormatDatetimeExif:
    def test_parses_standard_exif_string(self):
        dt = format_datetime_exif("2026:04:14 15:30:00")
        assert dt == datetime(2026, 4, 14, 15, 30, 0)
        assert dt.tzinfo is None  # captured_at is stored naive

    def test_rejects_malformed_string(self):
        with pytest.raises(ValueError):
            format_datetime_exif("not-a-timestamp")


class TestInstarPathIsNaive:
    def test_path_based_datetime_is_naive(self):
        result = parse_instar_path("INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.jpeg")
        assert result["datetime"] == datetime(2026, 4, 9, 16, 4, 5)
        assert result["datetime"].tzinfo is None


class TestGetDatetimeOriginalIsNaive:
    def test_exif_datetime_original_is_naive(self):
        exif = {"DateTimeOriginal": "2026:04:14 15:30:00"}
        dt = get_datetime_original(exif, filepath="/unused", allow_fallback=False)
        assert dt == datetime(2026, 4, 14, 15, 30, 0)
        assert dt.tzinfo is None


class TestParseExifOffset:
    def test_parses_positive_colon_form(self):
        assert _parse_exif_offset("+01:00") == timedelta(hours=1)

    def test_parses_negative_colon_form(self):
        assert _parse_exif_offset("-05:30") == timedelta(hours=-5, minutes=-30)

    def test_parses_compact_form(self):
        assert _parse_exif_offset("+0200") == timedelta(hours=2)

    def test_zero_offset(self):
        assert _parse_exif_offset("+00:00") == timedelta(0)

    def test_empty_returns_none(self):
        assert _parse_exif_offset("") is None

    def test_garbage_returns_none(self):
        assert _parse_exif_offset("abc") is None


class TestCheckExifOffset:
    def test_no_tag_short_circuits(self, monkeypatch, ingestion_log):
        called = {"n": 0}

        fake = types.ModuleType("db_operations")
        def tracked():
            called["n"] += 1
            return ZoneInfo("UTC")
        fake.get_server_timezone = tracked
        monkeypatch.setitem(sys.modules, "db_operations", fake)

        check_exif_offset({}, datetime(2026, 4, 14, 12, 0, 0))
        # Short-circuits on missing tag without asking the DB for a timezone.
        assert called["n"] == 0
        assert ingestion_log.messages == []

    def test_matching_offset_does_not_warn(self, monkeypatch, ingestion_log):
        _install_fake_db_operations(monkeypatch, "UTC")
        exif = {"OffsetTimeOriginal": "+00:00"}
        check_exif_offset(exif, datetime(2026, 4, 14, 12, 0, 0))
        assert "EXIF offset disagrees with server timezone" not in ingestion_log.messages

    def test_mismatched_offset_warns(self, monkeypatch, ingestion_log):
        # Server says UTC; camera says +01:00. A warning must surface.
        _install_fake_db_operations(monkeypatch, "UTC")
        exif = {"OffsetTimeOriginal": "+01:00"}
        check_exif_offset(exif, datetime(2026, 4, 14, 12, 0, 0))
        assert "EXIF offset disagrees with server timezone" in ingestion_log.messages

    def test_unparseable_offset_warns(self, monkeypatch, ingestion_log):
        _install_fake_db_operations(monkeypatch, "UTC")
        exif = {"OffsetTimeOriginal": "garbage"}
        check_exif_offset(exif, datetime(2026, 4, 14, 12, 0, 0))
        assert "Unparseable EXIF OffsetTimeOriginal tag" in ingestion_log.messages
