"""The delete confirmation must say what it is about to destroy.

The bug this guards against, found on lab in August 2026: the camera delete
dialog counted cameras and nothing else. Removing an empty registration and
removing a camera with 374 images and months of verification work produced the
same text, and the cameras were never named while the table selection survives
filtering. One click took a live camera with all its verified observations.

Two things must hold:
- the counts come from the images table, never from the camera's own daily
  health report, which is what the camera claims and not what we hold,
- the preview is behind exactly the same access checks as the delete.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Camera  # noqa: E402
from routers.cameras import camera_delete_counts  # noqa: E402

ROUTERS = Path(_api) / "routers"


class _Rows:
    def __init__(self, rows):
        self._rows = list(rows)

    def all(self):
        return list(self._rows)


class _FakeSession:
    """Compiles the query so the SQL shape can be asserted, then returns rows."""

    def __init__(self, rows=()):
        self._rows = list(rows)
        self.compiled = []

    async def execute(self, query, params=None):
        self.compiled.append(str(query.compile(dialect=postgresql.dialect())))
        return _Rows(self._rows)


def _camera(camera_id: int, device_id: str | None = None) -> Camera:
    return Camera(id=camera_id, device_id=device_id, project_id=1)


class TestCounts:
    @pytest.mark.asyncio
    async def test_counts_are_mapped_to_the_right_camera(self):
        db = _FakeSession([(1, 374, 128), (2, 38, 0)])
        items = await camera_delete_counts(
            db, [_camera(1, "CAM-A"), _camera(2, "CAM-B")]
        )

        by_id = {i.camera_id: i for i in items}
        assert (by_id[1].images, by_id[1].verified_images) == (374, 128)
        assert (by_id[2].images, by_id[2].verified_images) == (38, 0)

    @pytest.mark.asyncio
    async def test_camera_with_no_images_is_still_listed_at_zero(self):
        """The dialog names the whole selection, so an empty camera must not
        silently drop out of the list."""
        db = _FakeSession([(1, 5, 1)])
        items = await camera_delete_counts(
            db, [_camera(1, "CAM-A"), _camera(2, "CAM-EMPTY")]
        )

        by_id = {i.camera_id: i for i in items}
        assert len(items) == 2
        assert (by_id[2].images, by_id[2].verified_images) == (0, 0)

    @pytest.mark.asyncio
    async def test_most_destructive_first(self):
        db = _FakeSession([(1, 3, 0), (2, 374, 128), (3, 0, 0)])
        items = await camera_delete_counts(
            db, [_camera(1, "CAM-A"), _camera(2, "CAM-B"), _camera(3, "CAM-C")]
        )
        assert [i.camera_id for i in items] == [2, 1, 3]

    @pytest.mark.asyncio
    async def test_label_falls_back_when_there_is_no_device_id(self):
        db = _FakeSession([])
        items = await camera_delete_counts(db, [_camera(9, None)])
        assert items[0].name == "Camera 9"

    @pytest.mark.asyncio
    async def test_empty_selection_runs_no_query(self):
        db = _FakeSession()
        assert await camera_delete_counts(db, []) == []
        assert db.compiled == []


class TestQueryShape:
    @pytest.mark.asyncio
    async def test_counts_come_from_images_not_the_health_report(self):
        """CameraResponse.total_images is the camera's own counter from its
        daily report. Reading that here would show a confident wrong number to
        someone about to destroy data."""
        db = _FakeSession([])
        await camera_delete_counts(db, [_camera(1, "CAM-A")])

        sql = db.compiled[0].lower()
        assert "from images" in sql
        assert "group by images.camera_id" in sql
        # Verified images counted in the same pass, not a second query.
        assert "filter (where images.is_verified)" in sql
        assert len(db.compiled) == 1


def _function_source(path: Path, name: str) -> str:
    text = path.read_text()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(text, node)
    raise AssertionError(f"{name} not found in {path}")


class TestAccessControlParity:
    """A preview that leaks image counts to someone who cannot delete would be
    a new access-control hole, so it loads and checks the same way."""

    def test_camera_preview_uses_the_same_helpers_as_the_delete(self):
        preview = _function_source(ROUTERS / "cameras.py", "delete_preview")
        delete = _function_source(ROUTERS / "cameras.py", "bulk_delete")
        for helper in ("_load_bulk_cameras", "_verify_admin_on_all_projects"):
            assert helper in preview, f"preview skips {helper}"
            assert helper in delete

    def test_project_preview_is_server_admin_only_like_the_delete(self):
        preview = _function_source(ROUTERS / "projects.py", "delete_project_preview")
        delete = _function_source(ROUTERS / "projects.py", "delete_project")
        assert "require_server_admin" in preview
        assert "require_server_admin" in delete

    def test_both_previews_share_one_counting_helper(self):
        """Two copies would drift, and then the two dialogs would disagree
        about what the same camera holds."""
        for path, func in [
            (ROUTERS / "cameras.py", "delete_preview"),
            (ROUTERS / "projects.py", "delete_project_preview"),
        ]:
            assert "camera_delete_counts" in _function_source(path, func)
