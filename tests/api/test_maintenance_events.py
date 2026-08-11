"""Tests for camera maintenance event validation."""
import os
import sys
from datetime import date, timedelta

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.camera_maintenance import (
    NOTE_MAX_LENGTH,
    VALID_ACTION_TYPES,
    validate_maintenance_event,
)

TODAY = date(2026, 8, 10)


def ok(action_types, event_date):
    assert validate_maintenance_event(action_types, event_date, TODAY) is None


def rejected(action_types, event_date):
    assert validate_maintenance_event(action_types, event_date, TODAY) is not None


class TestActionTypes:
    def test_single_action(self):
        ok(["battery_change"], TODAY)

    def test_multiple_actions(self):
        ok(["battery_change", "sd_card_swap", "inspection"], TODAY)

    def test_every_vocabulary_value(self):
        for action in VALID_ACTION_TYPES:
            ok([action], TODAY)

    def test_empty_list_rejected(self):
        rejected([], TODAY)

    def test_unknown_action_rejected(self):
        rejected(["battery_change", "oiling"], TODAY)

    def test_unknown_action_named_in_message(self):
        error = validate_maintenance_event(["oiling"], TODAY, TODAY)
        assert "oiling" in error

    def test_duplicate_actions_rejected(self):
        rejected(["repair", "repair"], TODAY)

    def test_non_string_action_rejected(self):
        # Caught by the unknown-actions branch (a non-string is never in the
        # vocabulary). The API layer never reaches this, Pydantic's List[str]
        # rejects non-strings with a 422 first.
        rejected([1], TODAY)

    def test_vocabulary_is_exact(self):
        # The frontend hardcodes the same values in its
        # MaintenanceActionType union; this pins the backend side so
        # drift shows up as a test failure instead of silent 400s.
        assert VALID_ACTION_TYPES == {
            "battery_change", "sd_card_swap", "inspection", "repair", "other",
        }


class TestEventDate:
    def test_past_date(self):
        ok(["inspection"], TODAY - timedelta(days=30))

    def test_today_boundary(self):
        ok(["inspection"], TODAY)

    def test_tomorrow_rejected(self):
        rejected(["inspection"], TODAY + timedelta(days=1))

    def test_far_future_rejected(self):
        rejected(["inspection"], TODAY + timedelta(days=365))


class TestNote:
    def test_none_note_ok(self):
        assert validate_maintenance_event(["repair"], TODAY, TODAY, None) is None

    def test_short_note_ok(self):
        assert validate_maintenance_event(["repair"], TODAY, TODAY, "changed the mount") is None

    def test_note_at_limit_ok(self):
        assert validate_maintenance_event(["repair"], TODAY, TODAY, "x" * NOTE_MAX_LENGTH) is None

    def test_note_over_limit_rejected(self):
        assert validate_maintenance_event(["repair"], TODAY, TODAY, "x" * (NOTE_MAX_LENGTH + 1)) is not None
