"""Tests for the delivery worker liveness check decisions."""
from datetime import datetime, timedelta, timezone

from delivery_liveness import (
    QUEUE_DEPTH_ALERT,
    STALE_AFTER,
    heartbeat_stale,
    parse_heartbeat,
    split_incidents,
    worker_problem,
)


NOW = datetime(2026, 8, 10, 12, 0, 0, tzinfo=timezone.utc)


class TestParseHeartbeat:
    def test_valid_iso(self):
        assert parse_heartbeat("2026-08-10T11:59:00+00:00") == datetime(
            2026, 8, 10, 11, 59, 0, tzinfo=timezone.utc
        )

    def test_missing(self):
        assert parse_heartbeat(None) is None
        assert parse_heartbeat("") is None

    def test_garbage(self):
        assert parse_heartbeat("not-a-date") is None


class TestHeartbeatStale:
    def test_fresh(self):
        assert heartbeat_stale(NOW - timedelta(minutes=1), NOW) is False

    def test_exactly_threshold_is_not_stale(self):
        # Strict comparison, matching the repo's other threshold checks
        assert heartbeat_stale(NOW - STALE_AFTER, NOW) is False

    def test_past_threshold_is_stale(self):
        assert heartbeat_stale(NOW - STALE_AFTER - timedelta(seconds=1), NOW) is True

    def test_never_seen_is_stale(self):
        assert heartbeat_stale(None, NOW) is True


class TestWorkerProblem:
    def test_healthy_worker_is_none(self):
        assert worker_problem(NOW - timedelta(minutes=1), "notification-email", 3, NOW) is None

    def test_stale_heartbeat(self):
        last_seen = NOW - timedelta(days=27)
        reason = worker_problem(last_seen, "notification-email", 3, NOW)
        assert "no heartbeat since" in reason
        assert "27 days ago" in reason

    def test_stale_today_wording(self):
        reason = worker_problem(NOW - timedelta(minutes=20), "notification-email", 3, NOW)
        assert "today" in reason

    def test_never_seen_wording(self):
        assert worker_problem(None, "notification-email", 0, NOW) == "no heartbeat ever recorded"

    def test_depth_boundary(self):
        # Strict >, the threshold itself does not fire
        fresh = NOW - timedelta(minutes=1)
        assert worker_problem(fresh, "notification-email", QUEUE_DEPTH_ALERT - 1, NOW) is None
        assert worker_problem(fresh, "notification-email", QUEUE_DEPTH_ALERT, NOW) is None
        reason = worker_problem(fresh, "notification-email", QUEUE_DEPTH_ALERT + 1, NOW)
        assert "draining too slowly" in reason

    def test_both_conditions_one_combined_reason(self):
        reason = worker_problem(None, "notification-email", 431, NOW)
        assert "no heartbeat ever recorded" in reason
        assert "depth 431" in reason
        assert "draining too slowly" not in reason  # heartbeat is not fresh
        assert reason.count(";") == 1


class TestSplitIncidents:
    def test_fresh_incident(self):
        assert split_incidents(["notifications-email"], []) == (
            ["notifications-email"], [], []
        )

    def test_ongoing_is_suppressed(self):
        assert split_incidents(["notifications-email"], ["notifications-email"]) == (
            [], ["notifications-email"], []
        )

    def test_recovery_re_arms(self):
        assert split_incidents([], ["notifications-email"]) == (
            [], [], ["notifications-email"]
        )

    def test_reoffend_after_recovery_fires_again(self):
        new, ongoing, recovered = split_incidents(
            ["notifications-email", "notifications-telegram"], ["notifications-telegram"]
        )
        assert new == ["notifications-email"]
        assert ongoing == ["notifications-telegram"]
        assert recovered == []

    def test_empty_inputs(self):
        assert split_incidents([], []) == ([], [], [])
        assert split_incidents([], None) == ([], [], [])
