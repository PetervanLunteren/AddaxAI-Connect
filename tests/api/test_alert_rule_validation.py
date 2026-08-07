"""Tests for camera alert rule field validation."""
import os
import sys

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.camera_alert_rules import validate_rule_fields


def ok(*args):
    assert validate_rule_fields(*args) is None


def rejected(*args):
    assert validate_rule_fields(*args) is not None


class TestRuleType:
    def test_valid_types(self):
        ok("battery_low", 20, ["email"], None)
        ok("sd_full", 90, ["telegram"], None)
        ok("camera_silent", 10, ["email", "telegram"], None)

    def test_unknown_type_rejected(self):
        rejected("wolf_in_daylight", 20, ["email"], None)


class TestThreshold:
    def test_percent_bounds(self):
        ok("battery_low", 1, ["email"], None)
        ok("battery_low", 99, ["email"], None)
        rejected("battery_low", 0, ["email"], None)
        rejected("battery_low", 100, ["email"], None)
        rejected("sd_full", 0, ["email"], None)

    def test_days_bounds(self):
        ok("camera_silent", 1, ["email"], None)
        ok("camera_silent", 365, ["email"], None)
        rejected("camera_silent", 0, ["email"], None)
        rejected("camera_silent", 366, ["email"], None)


class TestChannels:
    def test_empty_rejected(self):
        rejected("battery_low", 20, [], None)

    def test_duplicates_rejected(self):
        rejected("battery_low", 20, ["email", "email"], None)

    def test_unknown_rejected(self):
        rejected("battery_low", 20, ["carrier_pigeon"], None)


class TestCameraIds:
    def test_null_means_all_cameras(self):
        ok("battery_low", 20, ["email"], None)

    def test_empty_list_rejected(self):
        # "All cameras" has exactly one representation, null
        rejected("battery_low", 20, ["email"], [])

    def test_duplicates_rejected(self):
        rejected("battery_low", 20, ["email"], [1, 1])

    def test_non_integers_rejected(self):
        rejected("battery_low", 20, ["email"], [1, "2"])

    def test_valid_list(self):
        ok("battery_low", 20, ["email"], [1, 2, 3])
