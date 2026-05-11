"""Tests for the deployment-timeline helper.

Pure-Python tests for the sweep-line, clipping, and SQL-compile checks.
No DB connection needed: a FakeSession compiles each query against the
postgres dialect (catches missing-select_from / JOIN-inference bugs at
test time) and returns empty rows so the python-side aggregation runs."""
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
    _clip_interval,
    _concurrent_sweep,
    get_deployment_timeline,
)


class TestConcurrentSweep:
    def test_empty_returns_empty(self):
        assert _concurrent_sweep([]) == []

    def test_single_interval_emits_open_and_close(self):
        out = _concurrent_sweep([(date(2024, 1, 1), date(2024, 1, 3))])
        assert out == [
            {"date": date(2024, 1, 1), "count": 1},
            {"date": date(2024, 1, 4), "count": 0},
        ]

    def test_two_non_overlapping_intervals(self):
        out = _concurrent_sweep([
            (date(2024, 1, 1), date(2024, 1, 3)),
            (date(2024, 2, 1), date(2024, 2, 5)),
        ])
        assert out == [
            {"date": date(2024, 1, 1), "count": 1},
            {"date": date(2024, 1, 4), "count": 0},
            {"date": date(2024, 2, 1), "count": 1},
            {"date": date(2024, 2, 6), "count": 0},
        ]

    def test_two_overlapping_intervals(self):
        # Interval A: Jan 1-10, B: Jan 5-15. Overlap Jan 5-10 (count=2).
        out = _concurrent_sweep([
            (date(2024, 1, 1), date(2024, 1, 10)),
            (date(2024, 1, 5), date(2024, 1, 15)),
        ])
        assert out == [
            {"date": date(2024, 1, 1), "count": 1},
            {"date": date(2024, 1, 5), "count": 2},
            {"date": date(2024, 1, 11), "count": 1},
            {"date": date(2024, 1, 16), "count": 0},
        ]

    def test_three_intervals_shared_start(self):
        # All three share Jan 1 start; count jumps to 3 immediately.
        out = _concurrent_sweep([
            (date(2024, 1, 1), date(2024, 1, 5)),
            (date(2024, 1, 1), date(2024, 1, 3)),
            (date(2024, 1, 1), date(2024, 1, 7)),
        ])
        # First point is jan 1 with count 3 (events collapsed).
        assert out[0] == {"date": date(2024, 1, 1), "count": 3}
        # Last point drops to 0.
        assert out[-1]["count"] == 0

    def test_count_never_goes_negative_in_well_formed_input(self):
        out = _concurrent_sweep([
            (date(2024, 1, 1), date(2024, 1, 10)),
            (date(2024, 1, 11), date(2024, 1, 20)),
        ])
        assert all(p["count"] >= 0 for p in out)

    def test_final_point_drops_to_zero(self):
        out = _concurrent_sweep([
            (date(2024, 1, 1), date(2024, 1, 5)),
            (date(2024, 2, 1), date(2024, 2, 7)),
            (date(2024, 1, 3), date(2024, 1, 6)),
        ])
        assert out[-1]["count"] == 0


class TestClipInterval:
    def test_no_clip_returns_input(self):
        out = _clip_interval(
            date(2024, 1, 1), date(2024, 1, 10),
            today=date(2024, 6, 1), clip_start=None, clip_end=None,
        )
        assert out == (date(2024, 1, 1), date(2024, 1, 10))

    def test_active_deployment_uses_today(self):
        # end_date is None => "still active", effective end is today.
        out = _clip_interval(
            date(2024, 1, 1), None,
            today=date(2024, 3, 15), clip_start=None, clip_end=None,
        )
        assert out == (date(2024, 1, 1), date(2024, 3, 15))

    def test_clip_start_trims_left_edge(self):
        out = _clip_interval(
            date(2024, 1, 1), date(2024, 1, 31),
            today=date(2024, 6, 1),
            clip_start=date(2024, 1, 15), clip_end=None,
        )
        assert out == (date(2024, 1, 15), date(2024, 1, 31))

    def test_clip_end_trims_right_edge(self):
        out = _clip_interval(
            date(2024, 1, 1), date(2024, 1, 31),
            today=date(2024, 6, 1),
            clip_start=None, clip_end=date(2024, 1, 20),
        )
        assert out == (date(2024, 1, 1), date(2024, 1, 20))

    def test_interval_entirely_before_window_returns_none(self):
        out = _clip_interval(
            date(2024, 1, 1), date(2024, 1, 31),
            today=date(2024, 12, 31),
            clip_start=date(2024, 6, 1), clip_end=date(2024, 6, 30),
        )
        assert out is None

    def test_interval_entirely_after_window_returns_none(self):
        out = _clip_interval(
            date(2024, 6, 1), date(2024, 6, 30),
            today=date(2024, 12, 31),
            clip_start=date(2024, 1, 1), clip_end=date(2024, 1, 31),
        )
        assert out is None

    def test_inverted_dates_return_none(self):
        # Defensive: end_date earlier than start_date should not produce a bar.
        out = _clip_interval(
            date(2024, 6, 1), date(2024, 1, 1),
            today=date(2024, 12, 31), clip_start=None, clip_end=None,
        )
        assert out is None


class _FakeResult:
    """Returns empty rows but exercises any iter() / .all() the caller uses."""

    def __init__(self):
        pass

    def all(self):
        return []


class _CompileAssertingSession:
    """Forces SQLAlchemy to compile each query against the postgres dialect.
    Catches missing-select_from / JOIN-inference bugs at test time, same
    pattern as in test_activity_overlap.py."""

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
        # Two queries: deployments + image counts.
        assert len(db.compiled_queries) == 2
        sql_lower = " ".join(db.compiled_queries).lower()
        assert "camera_deployment_periods" in sql_lower
        assert "images" in sql_lower
        # Empty rows => empty payload.
        assert payload["sites"] == []
        assert payload["concurrent_cameras"] == []
        assert payload["metrics"]["site_count"] == 0

    @pytest.mark.asyncio
    async def test_empty_project_ids_skips_db(self):
        db = _CompileAssertingSession()
        payload = await get_deployment_timeline(
            db=db,  # type: ignore[arg-type]
            project_ids=[],
        )
        assert db.compiled_queries == []
        assert payload["sites"] == []
        assert payload["metrics"]["site_count"] == 0
