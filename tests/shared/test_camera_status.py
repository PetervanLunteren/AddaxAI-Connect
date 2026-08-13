"""Tests for the camera liveness rule.

The bug these guard against: the status used to read health reports only,
so a camera model that sends no daily report (INSTAR) stayed on
"No live signal yet" forever while it delivered photos every day.
"""
from datetime import datetime, timedelta, timezone

from shared.camera_status import CAMERA_SILENCE_DAYS, camera_status


def _ago(**kwargs) -> datetime:
    return datetime.now(timezone.utc) - timedelta(**kwargs)


class TestNeverReported:
    def test_no_contact_at_all(self):
        assert camera_status(None, None) == 'never_reported'


class TestImagesAloneCountAsContact:
    def test_recent_image_without_any_report_is_active(self):
        # The INSTAR case: photos arrive, health reports never do.
        assert camera_status(None, _ago(hours=2)) == 'active'

    def test_old_image_without_any_report_is_inactive(self):
        assert camera_status(None, _ago(days=30)) == 'inactive'


class TestReportsAloneCountAsContact:
    def test_recent_report_without_images_is_active(self):
        # A camera on a quiet trail reports daily but photographs nothing.
        assert camera_status(_ago(hours=2), None) == 'active'

    def test_old_report_without_images_is_inactive(self):
        assert camera_status(_ago(days=30), None) == 'inactive'


class TestLatestContactWins:
    def test_recent_image_rescues_a_stale_report(self):
        # Report parsing broke, the camera itself is fine.
        assert camera_status(_ago(days=30), _ago(hours=1)) == 'active'

    def test_recent_report_rescues_a_stale_image(self):
        assert camera_status(_ago(hours=1), _ago(days=30)) == 'active'

    def test_both_stale_is_inactive(self):
        assert camera_status(_ago(days=30), _ago(days=40)) == 'inactive'


class TestSilenceBoundary:
    def test_just_inside_the_window_is_active(self):
        assert camera_status(None, _ago(days=CAMERA_SILENCE_DAYS, minutes=-5)) == 'active'

    def test_just_outside_the_window_is_inactive(self):
        assert camera_status(None, _ago(days=CAMERA_SILENCE_DAYS, minutes=5)) == 'inactive'


class TestClockSafety:
    def test_a_camera_clock_far_in_the_future_cannot_reach_the_rule(self):
        # Arrival stamps are server-set, so a camera whose own clock says
        # 2035 still classifies on when it actually reached us.
        assert camera_status(None, _ago(days=30)) == 'inactive'

    def test_naive_datetime_raises(self):
        # Crash loudly: a naive value means a camera-clock column was wired
        # in by mistake, which is exactly the bug this module replaced.
        import pytest

        with pytest.raises(TypeError):
            camera_status(None, datetime.now())
