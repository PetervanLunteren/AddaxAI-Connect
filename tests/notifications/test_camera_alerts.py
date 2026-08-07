"""Tests for the camera condition alert rules evaluation."""
from datetime import datetime, timedelta

from camera_alerts import (
    CamState,
    battery_offending,
    sd_offending,
    silent_offending,
    split_incidents,
    rule_label,
    value_label,
)


NOW = datetime(2026, 8, 7, 12, 0, 0)  # naive, like the job's naive_now


class TestBatteryOffending:
    def test_below_threshold_fires(self):
        assert battery_offending(19, 20) is True

    def test_at_threshold_does_not_fire(self):
        # Strict comparison, "below 20" means 19 and lower
        assert battery_offending(20, 20) is False

    def test_none_never_fires(self):
        # Cameras without health reports have no battery value
        assert battery_offending(None, 20) is False


class TestSdOffending:
    def test_above_threshold_fires(self):
        assert sd_offending(90.5, 90) is True

    def test_at_threshold_does_not_fire(self):
        assert sd_offending(90.0, 90) is False

    def test_none_never_fires(self):
        assert sd_offending(None, 90) is False


class TestSilentOffending:
    def test_exactly_threshold_days_does_not_fire(self):
        last_seen = NOW - timedelta(days=10)
        assert silent_offending(last_seen, 10, NOW) is False

    def test_over_threshold_fires(self):
        last_seen = NOW - timedelta(days=10, minutes=1)
        assert silent_offending(last_seen, 10, NOW) is True

    def test_never_seen_camera_never_fires(self):
        # A freshly registered camera with no report and no image must not
        # alarm on day one
        assert silent_offending(None, 10, NOW) is False


class TestSplitIncidents:
    def test_fresh_incident(self):
        new, ongoing, recovered = split_incidents([1, 2], [])
        assert (new, ongoing, recovered) == ([1, 2], [], [])

    def test_ongoing_is_suppressed(self):
        new, ongoing, recovered = split_incidents([1, 2], [1, 2])
        assert (new, ongoing, recovered) == ([], [1, 2], [])

    def test_recovery_clears(self):
        new, ongoing, recovered = split_incidents([1], [1, 2])
        assert (new, ongoing, recovered) == ([], [1], [2])

    def test_reoffend_after_recovery_fires_again(self):
        # Camera 2 recovered earlier (removed from state), now offends again
        new, ongoing, recovered = split_incidents([1, 2], [1])
        assert (new, ongoing, recovered) == ([2], [1], [])

    def test_empty_inputs(self):
        assert split_incidents([], []) == ([], [], [])
        assert split_incidents([], [3]) == ([], [], [3])

    def test_none_previously_notified_is_tolerated(self):
        new, ongoing, recovered = split_incidents([1], None)
        assert (new, ongoing, recovered) == ([1], [], [])


class TestLabels:
    def test_rule_labels(self):
        assert rule_label("battery_low", 20) == "battery below 20%"
        assert rule_label("sd_full", 90) == "SD card above 90% full"
        assert rule_label("camera_silent", 10) == "silent for more than 10 days"
        assert rule_label("camera_silent", 1) == "silent for more than 1 day"

    def test_value_labels(self):
        battery = CamState(device_id="a", battery_percent=14,
                           sd_utilization_percent=None, last_seen=None)
        assert value_label("battery_low", battery) == "14%"
        sd = CamState(device_id="a", battery_percent=None,
                      sd_utilization_percent=95.6, last_seen=None)
        assert value_label("sd_full", sd) == "96% full"
        silent = CamState(device_id="a", battery_percent=None,
                          sd_utilization_percent=None,
                          last_seen=datetime(2026, 5, 3, 8, 0))
        assert value_label("camera_silent", silent) == "last seen May 03"


class TestLastSeenSemantics:
    def test_newer_of_report_and_image_wins(self):
        """The state loader takes max(report, image). Mirror the comparison
        here so the semantics are pinned: a camera whose last image is newer
        than its last report counts as seen at the image time."""
        report_time = NOW - timedelta(days=20)
        image_time = NOW - timedelta(days=2)
        last_seen = max(report_time, image_time)
        assert silent_offending(last_seen, 10, NOW) is False
        assert silent_offending(report_time, 10, NOW) is True
