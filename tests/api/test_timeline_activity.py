"""Tests for the pure helpers in `utils/timeline_activity`.

Pure-Python, no DB needed for the segment / clip helpers. The async DB
helpers are exercised with a compile-asserting fake session that ensures
the queries compile cleanly against the postgres dialect.
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

from utils.timeline_activity import (  # noqa: E402
    MAX_INNER_BAR_GAP_DAYS,
    clip_segments_to_window,
    concurrent_from_daily,
    concurrent_from_signal_days,
    daily_camera_counts,
    fetch_capture_days,
    fetch_report_days,
    split_into_segments,
)


class TestSplitIntoSegments:
    def test_empty_returns_empty(self):
        assert split_into_segments([]) == []

    def test_single_day(self):
        assert split_into_segments([date(2024, 1, 5)]) == [
            (date(2024, 1, 5), date(2024, 1, 5)),
        ]

    def test_two_consecutive_days(self):
        out = split_into_segments([date(2024, 1, 1), date(2024, 1, 2)])
        assert out == [(date(2024, 1, 1), date(2024, 1, 2))]

    def test_one_day_silence_splits(self):
        # Jan 1, skip Jan 2, then Jan 3. Any silent day breaks the bar.
        out = split_into_segments([date(2024, 1, 1), date(2024, 1, 3)])
        assert out == [
            (date(2024, 1, 1), date(2024, 1, 1)),
            (date(2024, 1, 3), date(2024, 1, 3)),
        ]

    def test_consecutive_days_merge(self):
        # Only fully-consecutive days share a segment.
        out = split_into_segments(
            [date(2024, 1, 1), date(2024, 1, 2), date(2024, 1, 3)]
        )
        assert out == [(date(2024, 1, 1), date(2024, 1, 3))]

    def test_three_day_silence_splits(self):
        out = split_into_segments([date(2024, 1, 1), date(2024, 1, 5)])
        assert out == [
            (date(2024, 1, 1), date(2024, 1, 1)),
            (date(2024, 1, 5), date(2024, 1, 5)),
        ]

    def test_mixed_run_splits_on_any_gap(self):
        days = [
            date(2024, 1, 1),
            date(2024, 1, 2),    # consecutive, merge with Jan 1
            date(2024, 1, 4),    # 1-day silence, splits
            date(2024, 1, 5),    # consecutive, merge with Jan 4
            date(2024, 1, 10),   # 4-day silence, splits
        ]
        out = split_into_segments(days)
        assert out == [
            (date(2024, 1, 1), date(2024, 1, 2)),
            (date(2024, 1, 4), date(2024, 1, 5)),
            (date(2024, 1, 10), date(2024, 1, 10)),
        ]

    def test_max_gap_constant_is_zero(self):
        # Any silent day creates a gap. `MAX_INNER_BAR_GAP_DAYS == 0`
        # means a gap of `(d2 - d1).days - 1 > 0` splits the segment,
        # i.e. only fully-consecutive days merge.
        assert MAX_INNER_BAR_GAP_DAYS == 0

    def test_unsorted_input_raises(self):
        with pytest.raises(ValueError):
            split_into_segments([date(2024, 1, 2), date(2024, 1, 1)])

    def test_duplicate_input_raises(self):
        # Duplicates mean the caller forgot to DISTINCT before passing in.
        with pytest.raises(ValueError):
            split_into_segments([date(2024, 1, 1), date(2024, 1, 1)])


class TestClipSegmentsToWindow:
    def test_empty_input(self):
        assert clip_segments_to_window([], date(2024, 1, 1), date(2024, 12, 31)) == []

    def test_inverted_window_returns_empty(self):
        out = clip_segments_to_window(
            [(date(2024, 1, 1), date(2024, 1, 31))],
            date(2024, 12, 31),
            date(2024, 1, 1),
        )
        assert out == []

    def test_fully_inside(self):
        out = clip_segments_to_window(
            [(date(2024, 1, 5), date(2024, 1, 20))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == [(date(2024, 1, 5), date(2024, 1, 20))]

    def test_fully_outside_before(self):
        out = clip_segments_to_window(
            [(date(2023, 12, 1), date(2023, 12, 31))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == []

    def test_fully_outside_after(self):
        out = clip_segments_to_window(
            [(date(2024, 2, 1), date(2024, 2, 28))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == []

    def test_straddles_left(self):
        out = clip_segments_to_window(
            [(date(2023, 12, 25), date(2024, 1, 10))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == [(date(2024, 1, 1), date(2024, 1, 10))]

    def test_straddles_right(self):
        out = clip_segments_to_window(
            [(date(2024, 1, 20), date(2024, 2, 10))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == [(date(2024, 1, 20), date(2024, 1, 31))]

    def test_identical_bounds(self):
        out = clip_segments_to_window(
            [(date(2024, 1, 1), date(2024, 1, 31))],
            date(2024, 1, 1),
            date(2024, 1, 31),
        )
        assert out == [(date(2024, 1, 1), date(2024, 1, 31))]


class TestConcurrentFromSignalDays:
    def test_empty(self):
        assert concurrent_from_signal_days({}) == []

    def test_distinct_cameras_per_day(self):
        signal_days = {
            10: [date(2024, 1, 1), date(2024, 1, 2)],
            11: [date(2024, 1, 1)],
        }
        out = concurrent_from_signal_days(signal_days)
        assert out == [
            {"date": date(2024, 1, 1), "count": 2},
            {"date": date(2024, 1, 2), "count": 1},
        ]

    def test_single_camera_signal_pattern(self):
        # Same camera across multiple days, gaps included.
        signal_days = {7: [date(2024, 1, 1), date(2024, 1, 3)]}
        out = concurrent_from_signal_days(signal_days)
        assert out == [
            {"date": date(2024, 1, 1), "count": 1},
            {"date": date(2024, 1, 3), "count": 1},
        ]


class TestConcurrentFromDaily:
    def test_empty(self):
        assert concurrent_from_daily([]) == []

    def test_single_day_single_camera(self):
        rows = [{"date": date(2024, 1, 1), "camera_id": 10, "count": 3}]
        assert concurrent_from_daily(rows) == [{"date": date(2024, 1, 1), "count": 1}]

    def test_distinct_cameras_per_day(self):
        rows = [
            {"date": date(2024, 1, 1), "camera_id": 10, "count": 1},
            {"date": date(2024, 1, 1), "camera_id": 11, "count": 4},
            {"date": date(2024, 1, 2), "camera_id": 10, "count": 2},
        ]
        out = concurrent_from_daily(rows)
        assert out == [
            {"date": date(2024, 1, 1), "count": 2},
            {"date": date(2024, 1, 2), "count": 1},
        ]

    def test_duplicate_camera_same_day_does_not_inflate(self):
        # Two rows for the same (day, camera) should count as one camera.
        rows = [
            {"date": date(2024, 1, 1), "camera_id": 10, "count": 1},
            {"date": date(2024, 1, 1), "camera_id": 10, "count": 4},
        ]
        out = concurrent_from_daily(rows)
        assert out == [{"date": date(2024, 1, 1), "count": 1}]


class _FakeResult:
    def all(self):
        return []


class _CompileAssertingSession:
    """Compiles each query against the postgres dialect, mirrors the helper
    used in test_timeline.py so we catch missing-select_from / JOIN-inference
    issues at test time."""

    def __init__(self) -> None:
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        compiled = query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
        self.compiled_queries.append(str(compiled))
        return _FakeResult()


class TestAsyncHelpersCompile:
    @pytest.mark.asyncio
    async def test_fetch_capture_days_skips_db_when_no_cameras(self):
        db = _CompileAssertingSession()
        out = await fetch_capture_days(db, [])  # type: ignore[arg-type]
        assert out == {}
        assert db.compiled_queries == []

    @pytest.mark.asyncio
    async def test_fetch_capture_days_compiles(self):
        db = _CompileAssertingSession()
        out = await fetch_capture_days(
            db,  # type: ignore[arg-type]
            [10, 11],
            clip_start=date(2024, 1, 1),
            clip_end=date(2024, 12, 31),
        )
        assert out == {}
        assert len(db.compiled_queries) == 1
        sql = db.compiled_queries[0].lower()
        assert "images" in sql
        assert "is_hidden" in sql

    @pytest.mark.asyncio
    async def test_fetch_report_days_skips_db_when_no_cameras(self):
        db = _CompileAssertingSession()
        out = await fetch_report_days(db, [])  # type: ignore[arg-type]
        assert out == {}
        assert db.compiled_queries == []

    @pytest.mark.asyncio
    async def test_fetch_report_days_compiles(self):
        db = _CompileAssertingSession()
        out = await fetch_report_days(
            db,  # type: ignore[arg-type]
            [10, 11],
            clip_start=date(2024, 1, 1),
            clip_end=date(2024, 12, 31),
        )
        assert out == {}
        assert len(db.compiled_queries) == 1
        sql = db.compiled_queries[0].lower()
        assert "camera_health_reports" in sql

    @pytest.mark.asyncio
    async def test_daily_camera_counts_skips_db_when_no_cameras(self):
        db = _CompileAssertingSession()
        out = await daily_camera_counts(db, [])  # type: ignore[arg-type]
        assert out == []
        assert db.compiled_queries == []

    @pytest.mark.asyncio
    async def test_daily_camera_counts_compiles(self):
        db = _CompileAssertingSession()
        out = await daily_camera_counts(
            db,  # type: ignore[arg-type]
            [10, 11, 12],
        )
        assert out == []
        assert len(db.compiled_queries) == 1
        sql = db.compiled_queries[0].lower()
        assert "count" in sql
        assert "is_hidden" in sql
