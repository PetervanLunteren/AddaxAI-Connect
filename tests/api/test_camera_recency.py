"""Tests for the per-camera recency lookups.

Two things matter here and both are easy to break silently:
- bulk-uploaded images must not count as the camera transmitting,
- the status must read arrival columns, not the camera-clock columns.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.camera_recency import fetch_camera_recency  # noqa: E402


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeSession:
    """Compiles each query against the postgres dialect, then hands back
    queued rows so the python-side map building runs."""

    def __init__(self, results):
        self._results = list(results)
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        self.compiled_queries.append(
            str(query.compile(dialect=postgresql.dialect()))
        )
        return _FakeResult(self._results.pop(0))


CAPTURED = datetime(2026, 8, 1, 12, 0)
INGESTED = datetime(2026, 8, 1, 13, 0, tzinfo=timezone.utc)
REPORTED = datetime(2026, 8, 2, 6, 0)
CREATED = datetime(2026, 8, 2, 7, 0, tzinfo=timezone.utc)


class TestQueryShape:
    @pytest.mark.asyncio
    async def test_live_filter_is_in_the_sql(self):
        db = _FakeSession([[], []])
        await fetch_camera_recency(db, [1])  # type: ignore[arg-type]

        image_sql = db.compiled_queries[0].lower()
        assert "filter (where images.origin" in image_sql
        assert "max(images.ingested_at)" in image_sql
        # The displayed last-image value stays unfiltered, bulk included.
        assert "max(images.captured_at)" in image_sql

    @pytest.mark.asyncio
    async def test_reports_select_both_clocks(self):
        db = _FakeSession([[], []])
        await fetch_camera_recency(db, [1])  # type: ignore[arg-type]

        report_sql = db.compiled_queries[1].lower()
        assert "max(camera_health_reports.reported_at)" in report_sql
        assert "max(camera_health_reports.created_at)" in report_sql

    @pytest.mark.asyncio
    async def test_no_camera_ids_skips_the_db(self):
        db = _FakeSession([])
        recency = await fetch_camera_recency(db, [])  # type: ignore[arg-type]

        assert db.compiled_queries == []
        assert recency.last_captured == {}
        assert recency.last_image_arrival == {}


class TestMapBuilding:
    @pytest.mark.asyncio
    async def test_splits_the_two_clocks_per_camera(self):
        db = _FakeSession([
            [(7, CAPTURED, INGESTED)],
            [(7, REPORTED, CREATED)],
        ])
        recency = await fetch_camera_recency(db, [7])  # type: ignore[arg-type]

        assert recency.last_captured == {7: CAPTURED}
        assert recency.last_image_arrival == {7: INGESTED}
        assert recency.last_reported == {7: REPORTED}
        assert recency.last_report_arrival == {7: CREATED}

    @pytest.mark.asyncio
    async def test_bulk_only_camera_has_no_image_arrival(self):
        # Postgres returns NULL for the filtered aggregate when every image
        # of that camera is bulk. The camera then has no live contact and
        # must stay out of last_image_arrival.
        db = _FakeSession([
            [(7, CAPTURED, None)],
            [],
        ])
        recency = await fetch_camera_recency(db, [7])  # type: ignore[arg-type]

        assert recency.last_captured == {7: CAPTURED}
        assert recency.last_image_arrival == {}
        assert recency.last_report_arrival == {}
