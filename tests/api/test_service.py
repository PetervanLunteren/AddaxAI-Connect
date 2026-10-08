"""Tests for the service router: visit and task validation, overdue, the
assignment email, and the site scope on both lists."""
import os
import sys
from datetime import date, timedelta

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from sqlalchemy.dialects import postgresql  # noqa: E402

from routers.service import (  # noqa: E402
    NOTE_MAX_LENGTH,
    VALID_ACTION_TYPES,
    _tasks_query,
    _visits_query,
    is_overdue,
    task_email_context,
    validate_actions_and_note,
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
        # The frontend hardcodes the same values in its MaintenanceActionType
        # union and in src/lib/service-actions.ts; this pins the backend side so
        # drift shows up as a test failure instead of silent 400s.
        assert VALID_ACTION_TYPES == {
            "battery_change", "sd_card_swap", "cleaning", "vegetation_clearing",
            "inspection", "angle_adjustment", "repair", "other",
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


class TestSharedFields:
    """The part a task and a visit share. A task has no date rule."""

    def test_ok(self):
        assert validate_actions_and_note(["cleaning"], "lens fogged") is None

    def test_empty_rejected(self):
        assert validate_actions_and_note([]) is not None

    def test_unknown_rejected(self):
        assert validate_actions_and_note(["oiling"]) is not None

    def test_note_over_limit_rejected(self):
        assert validate_actions_and_note(["repair"], "x" * (NOTE_MAX_LENGTH + 1)) is not None


class TestOverdue:
    def test_no_due_date_never_overdue(self):
        assert is_overdue(None, TODAY) is False

    def test_due_today_not_overdue(self):
        assert is_overdue(TODAY, TODAY) is False

    def test_due_tomorrow_not_overdue(self):
        assert is_overdue(TODAY + timedelta(days=1), TODAY) is False

    def test_due_yesterday_overdue(self):
        assert is_overdue(TODAY - timedelta(days=1), TODAY) is True


class TestTaskEmail:
    def context(self, **overrides):
        values = dict(
            project_name="SPW",
            assigner_email="admin@example.org",
            action_types=["battery_change", "sd_card_swap"],
            due_date=date(2026, 10, 20),
            note=None,
            cameras=[
                {"site_name": "Waterhole South", "camera_label": "861"},
                {"site_name": None, "camera_label": "999"},
                {"site_name": "big oak north", "camera_label": "862"},
            ],
        )
        values.update(overrides)
        return task_email_context(**values)

    def test_one_email_lists_every_camera(self):
        assert self.context()["task_count"] == 3

    def test_actions_use_labels(self):
        assert self.context()["actions_label"] == "Battery change, SD card swap"

    def test_due_label(self):
        assert self.context()["due_label"] == "20 Oct 2026"

    def test_no_due_date(self):
        assert self.context(due_date=None)["due_label"] is None

    def test_sorted_by_site_name_without_site_first(self):
        labels = [c["camera_label"] for c in self.context()["cameras"]]
        assert labels == ["999", "862", "861"]


def _sql(query) -> str:
    return str(query.compile(dialect=postgresql.dialect()))


class TestSiteScope:
    """Visits use the site on the visit date, tasks the current site. A
    restricted scope filters on that site, so rows without one drop out."""

    def test_visit_site_is_the_deployment_on_the_visit_date(self):
        sql = _sql(_visits_query(1, None))
        assert "deployments.start_date <= camera_maintenance_events.event_date" in sql
        assert "deployments.end_date >= camera_maintenance_events.event_date" in sql
        assert "ORDER BY deployments.deployment_number DESC" in sql

    def test_task_site_is_the_current_site(self):
        sql = _sql(_tasks_query(1, None))
        assert "deployments.start_date" not in sql
        assert "ORDER BY deployments.deployment_number DESC" in sql

    def test_unrestricted_has_no_site_filter(self):
        assert "sites.id IN" not in _sql(_visits_query(1, None))
        assert "sites.id IN" not in _sql(_tasks_query(1, None))

    def test_restricted_filters_on_site(self):
        assert "sites.id IN" in _sql(_visits_query(1, [4, 5]))
        assert "sites.id IN" in _sql(_tasks_query(1, [4, 5]))

    def test_scoped_to_project(self):
        assert "cameras.project_id = " in _sql(_visits_query(1, None))
        assert "cameras.project_id = " in _sql(_tasks_query(1, None))
