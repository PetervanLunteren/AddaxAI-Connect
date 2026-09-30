"""Pruning empty deployments after a curation delete.

Guards against the bug class that broke curation twice. The empty-deployment
branch of `cleanup_empty_deployments` kept a guard on Deployment columns that
were later dropped (`dep.notes`, fixed 17 Jun 2026 in aff5725d, then
`dep.name`, dropped 3 Jul 2026 in 7060d307), so every delete or hide that
emptied a deployment raised AttributeError and 500'd, which the UI showed as
nothing happening. Found on lab, 19 Sep 2026.

The tests run the helper against real Deployment ORM instances, so a
reference to a column that no longer exists on the model fails here instead
of on a production server.

Also pinned here: pruning runs on the delete path only. Bulk hide must not
prune, because `Image.deployment_id` is SET NULL on deployment delete and an
unhide cannot restore it, which permanently detaches the images from their
site.
"""
from __future__ import annotations

import ast
import os
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

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
        self.ops = []

    async def execute(self, query):
        self.ops.append("execute")
        return self._results.pop(0)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def flush(self):
        self.ops.append("flush")


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
async def test_empty_deployment_is_pruned_and_no_site_means_no_offer():
    dep = _deployment()  # site_id is None (legacy rows)
    db = _FakeSession([
        _FakeResult(rows=[dep]),      # the camera's deployments
        _FakeResult(scalar=0),        # visible images in the range
    ])

    emptied = await cleanup_empty_deployments(db, {1})

    assert db.deleted == [dep]
    assert emptied == []
    # The session runs autoflush=False, so the caller's pending db.delete()
    # rows must be flushed before any count, or a deployment emptied by that
    # very delete is never pruned.
    assert db.ops[0] == "flush"


@pytest.mark.asyncio
async def test_pruning_reports_the_site_it_emptied():
    dep = _deployment(site_id=5)
    db = _FakeSession([
        _FakeResult(rows=[dep]),
        _FakeResult(scalar=0),
        # sites among {5} that now have zero deployments
        _FakeResult(rows=[SimpleNamespace(id=5, name="Office")]),
    ])

    emptied = await cleanup_empty_deployments(db, {1})

    assert db.deleted == [dep]
    assert [(s.id, s.name) for s in emptied] == [(5, "Office")]


@pytest.mark.asyncio
async def test_site_with_remaining_deployments_is_not_reported():
    dep = _deployment(site_id=5)
    db = _FakeSession([
        _FakeResult(rows=[dep]),
        _FakeResult(scalar=0),
        _FakeResult(rows=[]),         # site 5 still has another deployment
    ])

    emptied = await cleanup_empty_deployments(db, {1})

    assert db.deleted == [dep]
    assert emptied == []


@pytest.mark.asyncio
async def test_deployment_with_images_is_kept():
    dep = _deployment(end_date=date(2026, 2, 1))
    db = _FakeSession([
        _FakeResult(rows=[dep]),
        _FakeResult(scalar=3),
    ])

    emptied = await cleanup_empty_deployments(db, {1})

    assert db.deleted == []
    assert emptied == []


@pytest.mark.asyncio
async def test_no_cameras_touches_nothing():
    db = _FakeSession([])

    emptied = await cleanup_empty_deployments(db, set())

    assert db.deleted == []
    assert emptied == []


def _function_calls(path: Path, function_name: str) -> set[str]:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            return {
                call.func.id
                for call in ast.walk(node)
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
            }
    raise AssertionError(f"{function_name} not found in {path}")


def test_hide_does_not_prune_and_delete_does():
    path = Path(_api) / "routers" / "image_admin.py"
    assert "cleanup_empty_deployments" not in _function_calls(path, "bulk_hide_images"), (
        "bulk hide must not prune deployments, unhide cannot restore the link"
    )
    assert "cleanup_empty_deployments" in _function_calls(path, "delete_images_by_ids")
