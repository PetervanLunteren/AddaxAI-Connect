"""
Structural tests asserting that hour extraction no longer strips a mistagged UTC
offset. After the captured_at refactor, the column is naive local so the SQL
should be a plain EXTRACT(hour FROM ...), nothing wrapped in AT TIME ZONE.
"""
import inspect
import sys
import os

_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils import preferred_counts
from utils.independence_filter import get_independent_hourly_activity


class TestPreferredCountsNoLocalHour:
    def test_local_hour_helper_removed(self):
        assert not hasattr(preferred_counts, "_local_hour"), (
            "_local_hour was a fix-on-read hack for the old mistagged-UTC convention. "
            "It must not come back."
        )

    def test_source_does_not_reference_timezone_utc_strip(self):
        src = inspect.getsource(preferred_counts)
        assert "timezone('UTC'" not in src
        assert "AT TIME ZONE 'UTC'" not in src


class TestIndependenceHourlyNoTimezoneStrip:
    def test_hourly_query_uses_plain_extract(self):
        src = inspect.getsource(get_independent_hourly_activity)
        assert "EXTRACT(hour FROM event_start)" in src
        assert "AT TIME ZONE 'UTC'" not in src
