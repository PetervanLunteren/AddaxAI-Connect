"""Deleting a camera that has bulk-upload jobs.

Two bugs this guards against, both found on lab in August 2026.

1. `bulk_upload_jobs.camera_id` is the only foreign key to `cameras.id`
   with no ON DELETE rule, so the delete died at commit time with a raw
   500. Finished jobs must be removed with the camera; a job the worker
   is still running must be refused with a clean 409 that names it.

2. The cascade deleted the object files *before* the commit. Object
   storage has no rollback, so the failed commit put every database row
   back while the raw images, crops and thumbnails stayed gone. The
   camera then looked untouched in the UI with every picture broken, and
   nothing anywhere reported it. Storage cleanup must happen only after
   the commit succeeds.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import BulkUploadJob, Camera  # noqa: E402
from routers.cameras import (  # noqa: E402
    LIVE_BULK_STATUSES,
    _assert_no_live_bulk_jobs,
    _delete_camera_cascade,
)

ROUTERS = Path(_api) / "routers"


class _Rows:
    def __init__(self, rows):
        self._rows = list(rows)

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _Rowcount:
    def __init__(self, count):
        self.rowcount = count


class _FakeSession:
    """Runs the cascade without a database.

    SELECTs return the next queued row list. DELETEs are matched on their
    target table, so the test does not depend on how many statements the
    cascade happens to emit.
    """

    def __init__(self, selects=(), rowcounts=None):
        self._selects = list(selects)
        self._rowcounts = dict(rowcounts or {})
        self.deleted_tables = []
        self.statements = []
        self.deleted_objects = []

    async def execute(self, query, params=None):
        sql = str(query).strip()
        self.statements.append(sql)
        if sql.upper().startswith("DELETE FROM"):
            table = sql.split("DELETE FROM", 1)[1].strip().split()[0]
            self.deleted_tables.append(table)
            return _Rowcount(self._rowcounts.get(table, 0))
        return _Rows(self._selects.pop(0) if self._selects else [])

    async def delete(self, obj):
        self.deleted_objects.append(obj)


def _camera(camera_id: int = 1, device_id: str | None = "CAM-1") -> Camera:
    return Camera(id=camera_id, device_id=device_id, project_id=1)


def _job(camera_id: int, status: str, filename: str) -> BulkUploadJob:
    return BulkUploadJob(
        id=camera_id * 100,
        uuid=f"job-{camera_id}-{status}",
        project_id=1,
        created_by_user_id=1,
        camera_id=camera_id,
        original_filename=filename,
        staged_object_key=f"1/job-{camera_id}/",
        status=status,
    )


class TestLiveJobBlocks:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", LIVE_BULK_STATUSES)
    async def test_every_live_status_blocks(self, status):
        db = _FakeSession([[_job(1, status, "spring-batch.zip")]])
        with pytest.raises(HTTPException) as exc:
            await _assert_no_live_bulk_jobs(db, [_camera()])
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_message_names_the_jobs_and_the_next_step(self):
        db = _FakeSession([[
            _job(1, "processing", "spring-batch.zip"),
            _job(1, "uploading", "march.zip"),
        ]])
        with pytest.raises(HTTPException) as exc:
            await _assert_no_live_bulk_jobs(db, [_camera()])

        detail = exc.value.detail
        assert "spring-batch.zip" in detail
        assert "march.zip" in detail
        assert "2 bulk uploads still running" in detail
        assert "bulk upload page" in detail
        # UI copy carries no colons, see the repo conventions.
        assert ":" not in detail

    @pytest.mark.asyncio
    async def test_single_job_is_not_pluralised(self):
        db = _FakeSession([[_job(1, "processing", "one.zip")]])
        with pytest.raises(HTTPException) as exc:
            await _assert_no_live_bulk_jobs(db, [_camera()])
        assert "1 bulk upload still running" in exc.value.detail

    @pytest.mark.asyncio
    async def test_no_jobs_does_not_raise(self):
        db = _FakeSession([[]])
        await _assert_no_live_bulk_jobs(db, [_camera()])

    @pytest.mark.asyncio
    async def test_empty_selection_runs_no_query(self):
        db = _FakeSession([])
        await _assert_no_live_bulk_jobs(db, [])
        assert db.statements == []


class TestBulkSelectionReportsEveryBlocker:
    """A ten-camera delete must not become ten retries."""

    @pytest.mark.asyncio
    async def test_all_blocking_cameras_are_named_at_once(self):
        cameras = [_camera(1, "CAM-A"), _camera(2, "CAM-B"), _camera(3, "CAM-C")]
        db = _FakeSession([[
            _job(1, "processing", "a.zip"),
            _job(3, "uploading", "c.zip"),
        ]])

        with pytest.raises(HTTPException) as exc:
            await _assert_no_live_bulk_jobs(db, cameras)

        detail = exc.value.detail
        assert exc.value.status_code == 409
        assert "2 of the selected cameras" in detail
        for expected in ("CAM-A", "a.zip", "CAM-C", "c.zip"):
            assert expected in detail
        # The camera with no live job is not accused.
        assert "CAM-B" not in detail

    @pytest.mark.asyncio
    async def test_camera_without_device_id_falls_back_to_its_label(self):
        db = _FakeSession([[_job(7, "processing", "x.zip")]])
        with pytest.raises(HTTPException) as exc:
            await _assert_no_live_bulk_jobs(
                db, [_camera(7, None), _camera(8, "CAM-8")]
            )
        assert "Camera 7" in exc.value.detail


class TestCascadeClearsFinishedJobs:
    @pytest.mark.asyncio
    async def test_finished_job_rows_are_deleted_with_the_camera(self):
        camera = _camera()
        db = _FakeSession(rowcounts={"images": 3, "bulk_upload_jobs": 1})

        counts, device_id = await _delete_camera_cascade(db, camera)

        assert counts["bulk_jobs"] == 1
        assert counts["images"] == 3
        assert device_id == "CAM-1"
        assert camera in db.deleted_objects
        # Without this the delete dies at commit on the foreign key.
        assert "bulk_upload_jobs" in db.deleted_tables

    @pytest.mark.asyncio
    async def test_device_id_falls_back_to_the_row_id(self):
        db = _FakeSession()
        _, device_id = await _delete_camera_cascade(db, _camera(42, None))
        assert device_id == "42"


def _function_source(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(path.read_text(), node)
    raise AssertionError(f"{name} not found in {path}")


class TestStorageDeletedAfterCommit:
    """The file-loss guard. Object storage cannot roll back, so every delete
    path must commit first and only then remove the objects."""

    @pytest.mark.parametrize(
        "path,func",
        [
            (ROUTERS / "cameras.py", "delete_camera"),
            (ROUTERS / "cameras.py", "bulk_delete"),
            (ROUTERS / "projects.py", "delete_project"),
        ],
    )
    def test_commit_comes_before_storage_cleanup(self, path, func):
        source = _function_source(path, func)
        assert "db.commit()" in source, f"{func} does not commit"
        assert "_delete_camera_storage" in source, f"{func} never cleans storage"
        assert source.index("db.commit()") < source.index("_delete_camera_storage"), (
            f"{func} deletes object files before the commit. A failed commit "
            f"would roll the rows back and lose the files for good."
        )

    def test_cascade_helper_does_no_storage_work(self):
        source = _function_source(ROUTERS / "cameras.py", "_delete_camera_cascade")
        assert "StorageClient" not in source
        assert "delete_object" not in source

    @pytest.mark.parametrize(
        "path,func",
        [
            (ROUTERS / "cameras.py", "delete_camera"),
            (ROUTERS / "cameras.py", "bulk_delete"),
            (ROUTERS / "projects.py", "delete_project"),
        ],
    )
    def test_every_delete_path_checks_for_live_jobs(self, path, func):
        source = _function_source(path, func)
        assert "_assert_no_live_bulk_jobs" in source, (
            f"{func} can still hit the bulk_upload_jobs foreign key at commit"
        )

    def test_project_delete_has_no_second_copy_of_the_cascade(self):
        """projects.py used to carry its own copy, so fixes in cameras.py
        never reached it."""
        source = _function_source(ROUTERS / "projects.py", "delete_project")
        assert "_delete_camera_cascade" in source
        assert "sql_delete(Image)" not in source
        assert "sql_delete(Detection)" not in source
