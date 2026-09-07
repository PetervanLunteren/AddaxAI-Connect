"""Tests for the shared ISO 8601 formatter the outbound integrations use."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from shared.timestamps import isoformat_with_offset

AMS = ZoneInfo("Europe/Amsterdam")


class TestIsoformatWithOffset:
    def test_naive_camera_time_gets_server_offset(self):
        # Summer time in Amsterdam is UTC+2; the offset must be in the string
        assert isoformat_with_offset(datetime(2026, 7, 1, 8, 30), AMS) == "2026-07-01T08:30:00+02:00"

    def test_winter_offset(self):
        assert isoformat_with_offset(datetime(2026, 1, 1, 8, 30), AMS) == "2026-01-01T08:30:00+01:00"

    def test_aware_passes_through(self):
        moment = datetime(2026, 7, 1, 6, 30, tzinfo=timezone.utc)
        assert isoformat_with_offset(moment) == "2026-07-01T06:30:00+00:00"

    def test_naive_without_timezone_raises(self):
        with pytest.raises(ValueError):
            isoformat_with_offset(datetime(2026, 7, 1, 8, 30))
