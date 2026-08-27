"""Tests for the per-camera rejected file counts, total and last week."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.camera_rejections import fetch_rejection_stats  # noqa: E402


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows):
        self._rows = rows
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        self.compiled_queries.append(str(query.compile(dialect=postgresql.dialect())))
        return _FakeResult(self._rows)


@pytest.mark.asyncio
async def test_counts_keyed_by_camera_and_missing_means_zero():
    # Camera 2 has one old setup shot: counted in the total, not this week
    db = _FakeSession([(1, 3, 3), (2, 1, 0)])
    stats = await fetch_rejection_stats(db, [1, 2, 3])
    assert stats.counts == {1: 3, 2: 1}
    assert stats.recent_counts == {1: 3, 2: 0}
    assert stats.counts.get(3, 0) == 0
    assert stats.recent_counts.get(3, 0) == 0


@pytest.mark.asyncio
async def test_one_grouped_query_over_the_camera_ids():
    db = _FakeSession([])
    now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    await fetch_rejection_stats(db, [7, 8], now=now)
    assert len(db.compiled_queries) == 1
    sql = db.compiled_queries[0]
    assert "GROUP BY rejections.camera_id" in sql
    assert "rejections.camera_id IN" in sql
    # The recent count is a filtered aggregate in the same query, not a
    # second round trip
    assert "FILTER (WHERE rejections.rejected_at >" in sql


@pytest.mark.asyncio
async def test_no_cameras_means_no_query():
    db = _FakeSession([])
    assert (await fetch_rejection_stats(db, [])).counts == {}
    assert db.compiled_queries == []
