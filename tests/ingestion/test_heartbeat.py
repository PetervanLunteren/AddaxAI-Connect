"""Tests for the ingestion liveness rule.

Ingestion consumes no queue, it watches the filesystem, so it stamps its
heartbeat from its own loop. The rule that matters is the observer guard:
watchdog can die while the process stays up, and from that moment nothing
uploaded is ever picked up again. A heartbeat proving only that the
process exists would hide exactly that.
"""
from shared.queue import HEARTBEAT_TICK_SECONDS

from main import heartbeat_due


class TestHeartbeatDue:
    def test_stamps_on_the_first_pass(self):
        assert heartbeat_due(True, 1000.0, 0.0) is True

    def test_waits_out_the_tick(self):
        assert heartbeat_due(True, 1000.0, 1000.0) is False
        assert heartbeat_due(True, 1000.0 + HEARTBEAT_TICK_SECONDS - 1, 1000.0) is False

    def test_stamps_once_the_tick_has_passed(self):
        assert heartbeat_due(True, 1000.0 + HEARTBEAT_TICK_SECONDS, 1000.0) is True

    def test_a_dead_observer_never_stamps(self):
        """The whole point. No file event can arrive any more, so the
        worker must go stale and raise the alarm rather than keep
        claiming it is alive."""
        assert heartbeat_due(False, 1000.0, 0.0) is False
        assert heartbeat_due(False, 99_999.0, 0.0) is False
