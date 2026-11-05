"""Every single-camera endpoint must return the same derived fields.

The bug this guards against: the create, update and reference-image
endpoints called `camera_to_response` directly, leaving the derived
arguments at their defaults. A healthy camera then came back as
`never_reported` with no site and no timestamps, and the detail sheet
showed exactly that after saving an edit.
"""
from __future__ import annotations

import ast
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Camera  # noqa: E402
from routers.cameras import camera_to_response  # noqa: E402
from utils.camera_rejections import RecentRejections  # noqa: E402

TZ = ZoneInfo("Europe/Brussels")

ROUTERS = Path(_api) / "routers"
SINGLE_CAMERA_FILES = [ROUTERS / "cameras.py", ROUTERS / "camera_reference_images.py"]


def _camera() -> Camera:
    return Camera(
        id=1,
        device_id="CAM-ALIVE",
        project_id=1,
        config={"last_health_report": {"battery_percentage": 88}},
        tags=[],
        notes="",
    )


class TestDerivedArgumentsDriveTheResponse:
    def test_full_arguments_give_a_live_camera(self):
        now = datetime.now(timezone.utc)
        out = camera_to_response(
            _camera(),
            tz=TZ,
            last_captured_at=datetime(2026, 8, 13, 9, 0),
            last_reported_at=datetime(2026, 8, 13, 6, 0),
            last_report_arrival=now - timedelta(hours=3),
            last_image_arrival=now - timedelta(hours=1),
            current_site={"id": 5, "name": "Site 3"},
        )
        assert out.status == "active"
        assert out.last_report_timestamp is not None
        assert out.last_image_timestamp is not None
        assert out.current_site == {"id": 5, "name": "Site 3"}

    def test_omitting_them_looks_dead(self):
        # Not a supported way to build a response, just proof of what the
        # defaults do. This is why every endpoint goes through
        # camera_detail_response instead.
        out = camera_to_response(_camera(), tz=TZ)
        assert out.status == "never_reported"
        assert out.last_report_timestamp is None
        assert out.current_site is None


class TestRejectingFlag:
    """The chip and the filter read `rejecting`, the column reads the count."""

    def _out(self, rejections_visible=True, recent=None, last_image_arrival=None):
        return camera_to_response(
            _camera(), tz=TZ, last_image_arrival=last_image_arrival,
            rejections_visible=rejections_visible, recent_rejections=recent,
        )

    def test_recovered_camera_keeps_its_count_but_is_not_rejecting(self):
        now = datetime.now(timezone.utc)
        out = self._out(
            recent=RecentRejections(count=2, last_rejected_at=now - timedelta(hours=3)),
            last_image_arrival=now - timedelta(hours=1),
        )
        assert out.rejected_count_recent == 2
        assert out.rejecting is False

    def test_rejection_after_the_last_live_image_is_rejecting(self):
        now = datetime.now(timezone.utc)
        out = self._out(
            recent=RecentRejections(count=1, last_rejected_at=now - timedelta(minutes=5)),
            last_image_arrival=now - timedelta(hours=1),
        )
        assert out.rejecting is True

    def test_no_recent_rejections_reads_zero_and_not_rejecting(self):
        out = self._out(recent=None)
        assert out.rejected_count_recent == 0
        assert out.rejecting is False

    def test_restricted_viewer_gets_neither(self):
        now = datetime.now(timezone.utc)
        out = self._out(
            rejections_visible=False,
            recent=RecentRejections(count=4, last_rejected_at=now),
        )
        assert out.rejected_count_recent is None
        assert out.rejecting is None


class TestNoEndpointBuildsTheResponseItself:
    """`camera_to_response` may only be called by the list endpoint and by
    `camera_detail_response`. Anything else drifts back into the bug."""

    @pytest.mark.parametrize("path", SINGLE_CAMERA_FILES, ids=lambda p: p.name)
    def test_only_sanctioned_callers(self, path: Path):
        tree = ast.parse(path.read_text())

        callers = []
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for inner in ast.walk(node):
                if (
                    isinstance(inner, ast.Call)
                    and isinstance(inner.func, ast.Name)
                    and inner.func.id == "camera_to_response"
                ):
                    callers.append(node.name)

        assert set(callers) <= {"list_cameras", "camera_detail_response"}, (
            f"{path.name}: camera_to_response called from {sorted(set(callers))}. "
            "Single-camera endpoints must call camera_detail_response instead, "
            "or they will report a healthy camera as never_reported."
        )

    @pytest.mark.parametrize("path", SINGLE_CAMERA_FILES, ids=lambda p: p.name)
    def test_every_response_model_endpoint_is_covered(self, path: Path):
        """Any route declaring response_model=CameraResponse must return
        either the list or camera_detail_response."""
        tree = ast.parse(path.read_text())

        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            declares_camera_response = any(
                isinstance(kw, ast.keyword)
                and kw.arg == "response_model"
                and "CameraResponse" in ast.unparse(kw.value)
                for dec in node.decorator_list
                if isinstance(dec, ast.Call)
                for kw in dec.keywords
            )
            if not declares_camera_response:
                continue
            body = ast.unparse(node)
            assert (
                "camera_detail_response(" in body or "camera_to_response(" in body
            ), f"{path.name}:{node.name} returns a CameraResponse but builds nothing"
            if node.name != "list_cameras":
                assert "camera_detail_response(" in body, (
                    f"{path.name}:{node.name} must use camera_detail_response"
                )
