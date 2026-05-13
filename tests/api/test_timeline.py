"""Tests for the deployment-timeline helper.

Pure-Python tests for the small helpers, plus a compile-asserting
integration check on `get_deployment_timeline`. A FakeSession compiles
each query against the postgres dialect (catches missing-select_from /
JOIN-inference bugs at test time) and returns empty rows so the
python-side aggregation runs.
"""
from __future__ import annotations

import os
import sys
from datetime import date

import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.timeline import (  # noqa: E402
    _effective_cdp_end,
    _filter_days_to_cdp,
    get_deployment_timeline,
)


class TestEffectiveCdpEnd:
    def test_closed_cdp_uses_configured_end(self):
        out = _effective_cdp_end(
            configured_end=date(2024, 3, 31),
            start_date=date(2024, 1, 1),
            signal_days_in_cdp=[date(2024, 1, 5), date(2024, 1, 6)],
        )
        assert out == date(2024, 3, 31)

    def test_open_cdp_with_signals_uses_last_signal(self):
        out = _effective_cdp_end(
            configured_end=None,
            start_date=date(2024, 1, 1),
            signal_days_in_cdp=[date(2024, 1, 5), date(2024, 1, 20)],
        )
        assert out == date(2024, 1, 20)

    def test_open_cdp_no_signals_falls_back_to_start(self):
        out = _effective_cdp_end(
            configured_end=None,
            start_date=date(2024, 1, 1),
            signal_days_in_cdp=[],
        )
        assert out == date(2024, 1, 1)


class TestFilterDaysToCdp:
    def test_empty_days(self):
        assert _filter_days_to_cdp([], date(2024, 1, 1), date(2024, 12, 31)) == []

    def test_keeps_only_in_range(self):
        days = [
            date(2023, 12, 31),
            date(2024, 1, 1),
            date(2024, 6, 15),
            date(2024, 12, 31),
            date(2025, 1, 1),
        ]
        out = _filter_days_to_cdp(days, date(2024, 1, 1), date(2024, 12, 31))
        assert out == [date(2024, 1, 1), date(2024, 6, 15), date(2024, 12, 31)]

    def test_open_cdp_keeps_everything_after_start(self):
        days = [date(2024, 1, 1), date(2025, 1, 1), date(2030, 1, 1)]
        out = _filter_days_to_cdp(days, date(2024, 1, 1), cdp_end=None)
        assert out == days


class _FakeResult:
    def __init__(self, rows=None):
        self._rows = rows or []

    def all(self):
        return list(self._rows)


class _CompileAssertingSession:
    """Compiles each query against the postgres dialect to catch
    JOIN-inference / missing-select_from issues at test time, while
    returning empty rows so the downstream python aggregation still runs.
    """

    def __init__(self) -> None:
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        compiled = query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
        self.compiled_queries.append(str(compiled))
        return _FakeResult()


class TestTimelineQueryCompiles:
    @pytest.mark.asyncio
    async def test_timeline_queries_compile(self):
        db = _CompileAssertingSession()
        payload = await get_deployment_timeline(
            db=db,  # type: ignore[arg-type]
            project_ids=[1],
            camera_ids=[10, 11, 12],
            date_from=date(2024, 1, 1),
            date_to=date(2024, 12, 31),
            today=date(2024, 6, 1),
        )
        # The new flow issues at most one CDP query. The daily-counts and
        # last-reported queries are skipped because the empty CDP result
        # gives us no camera ids to follow up on.
        assert len(db.compiled_queries) == 1
        sql_lower = db.compiled_queries[0].lower()
        assert "camera_deployment_periods" in sql_lower
        # Empty CDP rows short-circuit to an empty payload with the new fields.
        assert payload["sites"] == []
        assert payload["concurrent_cameras"] == []
        assert payload["heatmap"] == []
        assert payload["cdp_transitions"] == []
        assert payload["metrics"]["site_count"] == 0
        assert payload["metrics"]["max_concurrent_cameras"] == 0

    @pytest.mark.asyncio
    async def test_empty_project_ids_skips_db(self):
        db = _CompileAssertingSession()
        payload = await get_deployment_timeline(
            db=db,  # type: ignore[arg-type]
            project_ids=[],
        )
        assert db.compiled_queries == []
        assert payload["sites"] == []
        assert payload["heatmap"] == []
        assert payload["cdp_transitions"] == []
        assert payload["metrics"]["site_count"] == 0
