"""Tests for clamping camera alert rules and project-wide emails to a
viewer's site scope."""
from datetime import datetime

from camera_alerts import CamState, offending_cameras
from db_operations import project_wide_email_skip_reason
from types import SimpleNamespace


NOW = datetime(2026, 8, 10, 12, 0, 0)


def _rule(camera_ids=None, rule_type="battery_low", threshold=20):
    return SimpleNamespace(
        id=1, camera_ids=camera_ids, rule_type=rule_type, threshold=threshold,
    )


def _low_battery_states(*camera_ids):
    return {
        cid: CamState(device_id=f"cam-{cid}", battery_percent=5,
                      sd_utilization_percent=None, last_seen=None)
        for cid in camera_ids
    }


class TestOffendingCamerasClamp:
    def test_unrestricted_sees_all(self):
        states = _low_battery_states(1, 2, 3)
        assert offending_cameras(_rule(), states, NOW, None) == [1, 2, 3]

    def test_null_camera_scope_is_clamped(self):
        # "All cameras" for a restricted viewer means all *their* cameras
        states = _low_battery_states(1, 2, 3)
        assert offending_cameras(_rule(), states, NOW, {2}) == [2]

    def test_explicit_camera_scope_is_intersected(self):
        states = _low_battery_states(1, 2, 3)
        assert offending_cameras(_rule(camera_ids=[1, 2]), states, NOW, {2, 3}) == [2]

    def test_empty_allow_set_silences_the_rule(self):
        states = _low_battery_states(1, 2)
        assert offending_cameras(_rule(), states, NOW, set()) == []


class TestProjectWideEmailSkipReason:
    def test_admin_membership_receives(self):
        assert project_wide_email_skip_reason(False, "project-admin", None) is None

    def test_unscoped_viewer_receives(self):
        assert project_wide_email_skip_reason(False, "project-viewer", None) is None

    def test_scoped_viewer_is_skipped(self):
        assert project_wide_email_skip_reason(False, "project-viewer", [1, 2]) == "site_restricted"

    def test_no_membership_is_skipped(self):
        # A preference row that outlived the membership must not keep
        # receiving full project reports
        assert project_wide_email_skip_reason(False, None, None) == "no_membership"

    def test_server_admin_without_membership_receives(self):
        assert project_wide_email_skip_reason(True, None, None) is None
