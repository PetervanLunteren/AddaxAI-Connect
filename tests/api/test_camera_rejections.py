"""Tests for the per-camera recent rejected files lookup."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.camera_rejections import RecentRejections, fetch_recent_rejections  # noqa: E402


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
async def test_keyed_by_camera_and_missing_means_none():
    t1 = datetime(2026, 10, 29, 8, 17, tzinfo=timezone.utc)
    t2 = datetime(2026, 10, 29, 9, 22, tzinfo=timezone.utc)
    db = _FakeSession([(1, 3, t1), (2, 1, t2)])
    recent = await fetch_recent_rejections(db, [1, 2, 3])
    assert recent == {
        1: RecentRejections(count=3, last_rejected_at=t1),
        2: RecentRejections(count=1, last_rejected_at=t2),
    }
    assert 3 not in recent


@pytest.mark.asyncio
async def test_one_grouped_query_limited_to_the_window():
    db = _FakeSession([])
    now = datetime(2026, 8, 27, 12, 0, tzinfo=timezone.utc)
    await fetch_recent_rejections(db, [7, 8], now=now)
    assert len(db.compiled_queries) == 1
    sql = db.compiled_queries[0]
    assert "GROUP BY rejections.camera_id" in sql
    assert "rejections.camera_id IN" in sql
    assert "rejections.rejected_at >" in sql
    assert "max(rejections.rejected_at)" in sql


@pytest.mark.asyncio
async def test_no_cameras_means_no_query():
    db = _FakeSession([])
    assert await fetch_recent_rejections(db, []) == {}
    assert db.compiled_queries == []
