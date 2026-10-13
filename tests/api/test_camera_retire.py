"""Retiring a camera: out of the project, data kept, device id freed.

What this guards:

1. The retire helper closes the open placement at the last photo (never
   before the placement started, today when there is no photo), stamps
   retired_at and removes the open service tasks. Without the close the old
   project keeps counting trap days for a camera that left.

2. Storage cleanup goes per image, never by camera prefix. A retired camera
   and its re-registration share one device id, so a prefix wipe for the new
   camera would take the old project's photos with it.

3. Every lookup that treats a camera as live skips retired rows. The device
   id is only unique among live cameras, so a lookup without the filter can
   return the retired row, or raise on two rows.
"""
from __future__ import annotations

import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Camera, Deployment  # noqa: E402
from routers.cameras import (  # noqa: E402
    ImageRef,
    _delete_camera_storage,
    _retire_camera,
    camera_delete_counts,
)
import routers.cameras as cameras_module  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
TODAY = date(2026, 10, 13)


class _Scalar:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        return self

    def all(self):
        return list(self._value or [])


class _Rowcount:
    def __init__(self, count):
        self.rowcount = count


class _FakeSession:
    """SELECTs return the queued values in order, DELETEs return a rowcount."""

    def __init__(self, selects=(), deleted_tasks=0):
        self._selects = list(selects)
        self._deleted_tasks = deleted_tasks
        self.statements = []

    async def execute(self, query, params=None):
        sql = str(query).strip()
        self.statements.append(sql)
        if sql.upper().startswith("DELETE FROM"):
            return _Rowcount(self._deleted_tasks)
        return _Scalar(self._selects.pop(0) if self._selects else None)


def _camera(camera_id: int = 1) -> Camera:
    return Camera(id=camera_id, device_id="CAM-1", project_id=1)


def _open_deployment(start: date) -> Deployment:
    return Deployment(id=10, camera_id=1, deployment_number=1, start_date=start, end_date=None)


class TestRetireCamera:
    @pytest.mark.asyncio
    async def test_stamps_retired_at_as_aware_utc(self):
        camera = _camera()
        await _retire_camera(_FakeSession(), camera, TODAY)
        assert camera.retired_at is not None
        assert camera.retired_at.tzinfo is not None

    @pytest.mark.asyncio
    async def test_closes_the_open_placement_at_the_last_photo(self):
        deployment = _open_deployment(date(2026, 3, 1))
        last_photo = datetime(2026, 9, 20, 14, 30)  # naive camera clock
        db = _FakeSession(selects=[deployment, last_photo])
        await _retire_camera(db, _camera(), TODAY)
        assert deployment.end_date == date(2026, 9, 20)

    @pytest.mark.asyncio
    async def test_never_closes_before_the_placement_started(self):
        """A bulk upload can leave a placement that starts after the last
        live photo. end before start would be a negative trap-day count."""
        deployment = _open_deployment(date(2026, 10, 1))
        db = _FakeSession(selects=[deployment, datetime(2026, 9, 20, 8, 0)])
        await _retire_camera(db, _camera(), TODAY)
        assert deployment.end_date == date(2026, 10, 1)

    @pytest.mark.asyncio
    async def test_closes_today_when_the_camera_never_sent_a_photo(self):
        deployment = _open_deployment(date(2026, 10, 1))
        db = _FakeSession(selects=[deployment, None])
        await _retire_camera(db, _camera(), TODAY)
        assert deployment.end_date == TODAY

    @pytest.mark.asyncio
    async def test_no_open_placement_is_fine(self):
        db = _FakeSession(selects=[None])
        await _retire_camera(db, _camera(), TODAY)
        # Only the deployment lookup and the task delete ran, no max query.
        assert len(db.statements) == 2

    @pytest.mark.asyncio
    async def test_returns_how_many_open_tasks_went(self):
        db = _FakeSession(selects=[None], deleted_tasks=3)
        assert await _retire_camera(db, _camera(), TODAY) == 3
        assert any("camera_service_tasks" in s for s in db.statements if s.upper().startswith("DELETE"))


class TestPreviewCountsOpenTasks:
    @pytest.mark.asyncio
    async def test_open_tasks_per_camera(self):
        cameras = [_camera(1), Camera(id=2, device_id="CAM-2", project_id=1)]
        db = _FakeSession(selects=[[(1, 10, 4)], [(2, 2)]])
        items = await camera_delete_counts(db, cameras)
        by_id = {i.camera_id: i for i in items}
        assert (by_id[1].images, by_id[1].verified_images, by_id[1].open_tasks) == (10, 4, 0)
        assert (by_id[2].images, by_id[2].verified_images, by_id[2].open_tasks) == (0, 0, 2)


class _FakeStorage:
    instances: list = []

    def __init__(self):
        self.calls = []
        _FakeStorage.instances.append(self)

    def delete_object_versions(self, bucket, key):
        self.calls.append(("versions", bucket, key))

    def delete_object(self, bucket, key):
        if key == "boom":
            raise RuntimeError("storage down")
        self.calls.append(("delete", bucket, key))

    def list_objects(self, bucket, prefix=None):
        self.calls.append(("list", bucket, prefix))
        return [f"{prefix}0.jpg", f"{prefix}1.jpg"] if bucket == "crops" else []


class TestStorageDeletionIsPerImage:
    @pytest.fixture(autouse=True)
    def _fake_storage(self, monkeypatch):
        _FakeStorage.instances = []
        monkeypatch.setattr(cameras_module, "StorageClient", _FakeStorage)

    def test_only_the_deleted_images_objects_go(self):
        refs = [ImageRef("u-1", "CAM-1/2026/10/u-1_a.jpg", "CAM-1/2026/10/u-1_a.jpg")]
        deleted = _delete_camera_storage(refs)
        calls = _FakeStorage.instances[0].calls
        assert ("versions", "raw-images", "CAM-1/2026/10/u-1_a.jpg") in calls
        assert ("delete", "thumbnails", "CAM-1/2026/10/u-1_a.jpg") in calls
        assert ("list", "crops", "u-1_") in calls
        assert ("delete", "crops", "u-1_0.jpg") in calls
        # Never a camera-wide prefix listing on the image buckets.
        assert not any(c[0] == "list" and c[1] != "crops" for c in calls)
        assert deleted == 4

    def test_one_failing_image_does_not_stop_the_rest(self):
        refs = [
            ImageRef("u-1", None, "boom"),
            ImageRef("u-2", "CAM-1/u-2.jpg", None),
        ]
        deleted = _delete_camera_storage(refs)
        calls = _FakeStorage.instances[0].calls
        assert ("versions", "raw-images", "CAM-1/u-2.jpg") in calls
        assert deleted == 3  # u-2 raw plus its two crops

    def test_missing_paths_are_skipped(self):
        assert _delete_camera_storage([ImageRef("u-9", None, None)]) == 2  # crops only


class TestLiveLookupsSkipRetiredCameras:
    """The device id is unique among live cameras only. Any lookup by device
    id that does not filter on retired_at can hit the retired row (ingestion
    would then write a new photo onto a camera that left) or two rows."""

    LOOKUP_FILES = [
        REPO / "services/ingestion/db_operations.py",
        REPO / "services/api/routers/cameras.py",
        REPO / "services/api/routers/bulk_upload.py",
    ]

    def test_every_device_id_lookup_filters_retired(self):
        offenders = []
        for path in self.LOOKUP_FILES:
            lines = path.read_text().splitlines()
            for i, line in enumerate(lines):
                if "filter_by(device_id=" in line or re.search(r"Camera\.device_id\s*==", line):
                    window = "\n".join(lines[i: i + 4])
                    if "retired_at" not in window:
                        offenders.append(f"{path.relative_to(REPO)}:{i + 1}")
        assert offenders == [], f"device id lookups without a retired filter: {offenders}"

    SCAN_FILES = [
        REPO / "services/notifications/camera_alerts.py",
        REPO / "services/notifications/theft_watch.py",
        REPO / "services/notifications/sim_expiry.py",
    ]

    def test_live_camera_scans_filter_retired(self):
        """The jobs that alarm on silent cameras must not see retired ones."""
        for path in self.SCAN_FILES:
            assert "Camera.retired_at.is_(None)" in path.read_text(), path.name


class TestDeleteEndpointsOfferKeepData:
    def test_both_delete_paths_can_retire(self):
        source = (REPO / "services/api/routers/cameras.py").read_text()
        for name in ("async def delete_camera", "async def bulk_delete"):
            body = source.split(name, 1)[1].split("\n@router", 1)[0]
            assert "keep_data" in body, name
            assert "await _retire_camera(" in body, name
            # A running bulk upload blocks a retire too, the worker would
            # otherwise write images onto a camera that is leaving.
            assert body.index("await _assert_no_live_bulk_jobs(") < body.index("await _retire_camera("), name
