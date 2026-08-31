"""Tests for the worker rows on the health endpoint.

The bug being locked out: the endpoint used to ask whether a worker's
Redis queue was readable and call that healthy. On the demo server, which
runs no ingestion, no detection and no classifier, all three reported
healthy for months. A queue accepts publishes whether or not anything is
consuming, so the check only ever caught Redis being down.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers import health as health_router  # noqa: E402


def _stamp(minutes_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


class _FakeRedisClient:
    def __init__(self, values: dict):
        self.values = values
        self.reads: list[str] = []

    def get(self, key):
        self.reads.append(key)
        return self.values.get(key)

    def ping(self):
        return True


class _FakeQueue:
    """Stands in for RedisQueue. Records which queue depths were asked
    for, so a row claiming a backlog it never read cannot pass."""

    def __init__(self, queue_name, values=None, depths=None, asked=None):
        self.queue_name = queue_name
        self.client = _FakeRedisClient(values or {})
        self._depths = depths or {}
        self._asked = asked if asked is not None else []

    def queue_depth(self):
        self._asked.append(self.queue_name)
        return self._depths.get(self.queue_name, 0)


def _install_queue(monkeypatch, values, depths=None, asked=None):
    monkeypatch.setattr(
        health_router,
        "RedisQueue",
        lambda name: _FakeQueue(name, values=values, depths=depths, asked=asked),
    )


class TestCheckHeartbeat:
    def test_fresh_stamp_is_healthy(self, monkeypatch):
        _install_queue(monkeypatch, {"heartbeat:detection": _stamp(0.5)})
        row = health_router.check_heartbeat("detection", "heartbeat:detection", "image-ingested")
        assert row.status == "healthy"
        assert "queue depth" in row.message

    def test_missing_stamp_is_unhealthy(self, monkeypatch):
        """The demo case: nothing ever stamped, so the worker never ran."""
        _install_queue(monkeypatch, {})
        row = health_router.check_heartbeat("detection", "heartbeat:detection", "image-ingested")
        assert row.status == "unhealthy"
        assert "never started" in row.message

    def test_stale_stamp_is_unhealthy(self, monkeypatch):
        _install_queue(monkeypatch, {"heartbeat:detection": _stamp(60)})
        row = health_router.check_heartbeat("detection", "heartbeat:detection", "image-ingested")
        assert row.status == "unhealthy"
        assert "stale after" in row.message

    def test_garbage_stamp_reads_as_never_started(self, monkeypatch):
        _install_queue(monkeypatch, {"heartbeat:detection": "not-a-date"})
        row = health_router.check_heartbeat("detection", "heartbeat:detection", "image-ingested")
        assert row.status == "unhealthy"

    def test_a_deep_queue_alone_never_makes_a_row_unhealthy(self, monkeypatch):
        """A backlog is work in progress, not an outage. Only the stamp
        decides, which is what lets the pipeline rows use this check."""
        _install_queue(
            monkeypatch,
            {"heartbeat:detection": _stamp(0.5)},
            depths={"image-ingested": 25_000},
        )
        row = health_router.check_heartbeat("detection", "heartbeat:detection", "image-ingested")
        assert row.status == "healthy"
        assert "25000" in row.message

    def test_without_a_queue_no_depth_is_reported_or_read(self, monkeypatch):
        """Ingestion watches the filesystem. Naming the queue it publishes
        to would put the detection backlog on the ingestion row."""
        asked: list[str] = []
        _install_queue(monkeypatch, {"heartbeat:ingestion": _stamp(0.5)}, asked=asked)
        row = health_router.check_heartbeat("ingestion", "heartbeat:ingestion")
        assert row.status == "healthy"
        assert "queue depth" not in row.message
        assert asked == []

    def test_a_healthy_ml_worker_reports_its_device(self, monkeypatch):
        _install_queue(
            monkeypatch,
            {"heartbeat:detection": _stamp(0.5), "device:detection": "cuda"},
        )
        row = health_router.check_heartbeat(
            "detection", "heartbeat:detection", "image-ingested", "device:detection"
        )
        assert row.status == "healthy"
        assert row.device == "cuda"

    def test_no_device_key_asked_means_no_device(self, monkeypatch):
        """Rows that never load a model (ingestion, notifications) carry
        nothing, whatever happens to be in Redis."""
        _install_queue(
            monkeypatch,
            {"heartbeat:ingestion": _stamp(0.5), "device:detection": "cuda"},
        )
        row = health_router.check_heartbeat("ingestion", "heartbeat:ingestion")
        assert row.device is None

    def test_a_dead_worker_never_shows_a_stale_device(self, monkeypatch):
        """The device key has no TTL. A worker that crashed at startup
        because the GPU vanished must not keep advertising cuda."""
        _install_queue(
            monkeypatch,
            {"heartbeat:detection": _stamp(60), "device:detection": "cuda"},
        )
        row = health_router.check_heartbeat(
            "detection", "heartbeat:detection", "image-ingested", "device:detection"
        )
        assert row.status == "unhealthy"
        assert row.device is None


class _FakeResult:
    def scalar(self):
        return 1


class _FakeSession:
    async def execute(self, *args, **kwargs):
        return _FakeResult()


class _FakeUser:
    id = "00000000-0000-0000-0000-000000000001"


WORKER_ROWS = {
    "ingestion",
    "detection",
    "classification",
    "notifications",
    "notifications-email",
    "notifications-telegram",
}


async def _services(monkeypatch, values, depths=None):
    """Run the endpoint with the infrastructure checks stubbed, and return
    {row name: status}."""
    _install_queue(monkeypatch, values, depths=depths)

    async def fake_http(name, url):
        return health_router.ServiceStatus(name=name, status="healthy", message="stub")

    monkeypatch.setattr(health_router, "check_http_service", fake_http)
    monkeypatch.setenv("BACKUP_ENABLED", "false")

    response = await health_router.get_services_health(
        current_user=_FakeUser(), db=_FakeSession()
    )
    return {s.name: s.status for s in response.services}


class TestServicesEndpoint:
    @pytest.mark.asyncio
    async def test_no_workers_running_reports_every_worker_row_unhealthy(self, monkeypatch):
        """The regression. A server running none of the workers must not
        report a single healthy worker row."""
        statuses = await _services(monkeypatch, values={})

        for row in WORKER_ROWS:
            assert statuses[row] == "unhealthy", f"{row} reported healthy with no worker alive"
        # Infrastructure is unaffected: it really is up
        assert statuses["postgres"] == "healthy"
        assert statuses["redis"] == "healthy"
        assert statuses["api"] == "healthy"

    @pytest.mark.asyncio
    async def test_every_worker_ticking_reports_healthy(self, monkeypatch):
        fresh = _stamp(0.5)
        statuses = await _services(
            monkeypatch,
            values={
                "heartbeat:ingestion": fresh,
                "heartbeat:detection": fresh,
                "heartbeat:classification": fresh,
                "heartbeat:notifications": fresh,
                "heartbeat:notifications-email": fresh,
                "heartbeat:notifications-telegram": fresh,
                "cold_tier:status": json.dumps({"status": "idle"}),
            },
        )
        for row in WORKER_ROWS:
            assert statuses[row] == "healthy", f"{row} reported unhealthy while ticking"

    @pytest.mark.asyncio
    async def test_one_dead_worker_is_isolated(self, monkeypatch):
        """A single stopped container must show as one red row, not take
        the whole page down with it."""
        fresh = _stamp(0.5)
        statuses = await _services(
            monkeypatch,
            values={
                "heartbeat:ingestion": fresh,
                "heartbeat:classification": fresh,
                "heartbeat:notifications": fresh,
                "heartbeat:notifications-email": fresh,
                "heartbeat:notifications-telegram": fresh,
            },
        )
        assert statuses["detection"] == "unhealthy"
        assert statuses["ingestion"] == "healthy"
        assert statuses["classification"] == "healthy"

    @pytest.mark.asyncio
    async def test_every_worker_row_is_present(self, monkeypatch):
        statuses = await _services(monkeypatch, values={})
        assert WORKER_ROWS.issubset(statuses.keys())


def test_the_queue_accessible_check_is_gone():
    """It reported healthy for a worker that did not exist. Nothing should
    bring it back under a new caller."""
    assert not hasattr(health_router, "check_worker_service")
