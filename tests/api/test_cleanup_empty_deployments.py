"""Pruning empty deployments after a curation delete or hide.

Guards against the bug class that broke curation twice. The empty-deployment
branch of `cleanup_empty_deployments` kept a guard on Deployment columns that
were later dropped (`dep.notes`, fixed 17 Jun 2026 in aff5725d, then
`dep.name`, dropped 3 Jul 2026 in 7060d307), so every delete or hide that
emptied a deployment raised AttributeError and 500'd, which the UI showed as
nothing happening. Found on lab, 19 Sep 2026.

The tests run the helper against real Deployment ORM instances, so a
reference to a column that no longer exists on the model fails here instead
of on a production server.
"""
from __future__ import annotations

import os
import sys
from datetime import date

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Deployment  # noqa: E402
from routers.image_admin import cleanup_empty_deployments  # noqa: E402


class _FakeResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = rows
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)

    def scalar_one(self):
        return self._scalar


class _FakeSession:
    """Feeds queued results to the helper and records deletes."""

    def __init__(self, results):
        self._results = list(results)
        self.deleted = []

    async def execute(self, query):
        return self._results.pop(0)

    async def delete(self, obj):
        self.deleted.append(obj)


def _deployment(**kwargs) -> Deployment:
    defaults = dict(
        camera_id=1,
        deployment_number=1,
        start_date=date(2026, 1, 1),
        end_date=None,
    )
    defaults.update(kwargs)
    return Deployment(**defaults)


@pytest.mark.asyncio
async def test_empty_deployment_is_pruned():
    dep = _deployment()
    db = _FakeSession([
        _FakeResult(rows=[dep]),      # the camera's deployments
        _FakeResult(scalar=0),        # visible images in the range
    ])

    await cleanup_empty_deployments(db, {1})

    assert db.deleted == [dep]


@pytest.mark.asyncio
async def test_deployment_with_images_is_kept():
    dep = _deployment(end_date=date(2026, 2, 1))
    db = _FakeSession([
        _FakeResult(rows=[dep]),
        _FakeResult(scalar=3),
    ])

    await cleanup_empty_deployments(db, {1})

    assert db.deleted == []


@pytest.mark.asyncio
async def test_no_cameras_touches_nothing():
    db = _FakeSession([])

    await cleanup_empty_deployments(db, set())

    assert db.deleted == []
