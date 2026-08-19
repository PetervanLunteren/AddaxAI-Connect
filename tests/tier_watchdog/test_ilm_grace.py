"""When a full hot disk counts as broken transitions, and when it does not.

The watchdog tags objects and measures the disk in the same tick, and it
ticks immediately on startup. So the size it reads says nothing about
whether MinIO is moving anything until the scanner has had a turn. These
tests pin the three conditions that have to hold before it convicts.
"""
from datetime import datetime, timedelta, timezone

from watchdog import ILM_GRACE_SECONDS, ilm_is_stuck

GB = 1024 ** 3
BUDGET = 10 * GB
OVER = int(17.27 * GB)      # pwn on 18 Aug, well past the 10% margin
UNDER = int(10.25 * GB)     # pwn the morning after, inside the margin

NOW = datetime(2026, 8, 19, 15, 4, tzinfo=timezone.utc)


def _tick(tagged, ago_seconds, cold=0):
    return {
        "tagged_count": tagged,
        "objects_cold": cold,
        "timestamp": (NOW - timedelta(seconds=ago_seconds)).isoformat(),
    }


def test_under_the_margin_is_never_stuck():
    assert not ilm_is_stuck(UNDER, BUDGET, _tick(16693, 86400), NOW)


def test_first_ever_tick_does_not_convict():
    """Fresh server, nothing in Redis yet. Nothing has been tagged, so a
    full disk is a backlog, not a fault."""
    assert not ilm_is_stuck(OVER, BUDGET, None, NOW)


def test_previous_tick_tagged_nothing_does_not_convict():
    assert not ilm_is_stuck(OVER, BUDGET, _tick(0, 86400), NOW)


def test_restart_within_the_grace_window_does_not_convict():
    """The real 18 Aug case. The 14:03 tick tagged 16693 objects, the .env
    fix restarted the container, and the 15:02 tick found the same full
    disk one hour later. ILM had not had its turn."""
    assert not ilm_is_stuck(OVER, BUDGET, _tick(16693, 3600), NOW)


def test_still_full_after_the_grace_window_convicts():
    assert ilm_is_stuck(OVER, BUDGET, _tick(16693, ILM_GRACE_SECONDS + 60), NOW)


def test_still_full_a_day_later_convicts():
    assert ilm_is_stuck(OVER, BUDGET, _tick(16445, 86400), NOW)


def test_exactly_at_the_grace_boundary_convicts():
    assert ilm_is_stuck(OVER, BUDGET, _tick(1, ILM_GRACE_SECONDS), NOW)


def test_unreadable_previous_timestamp_does_not_convict():
    """Better a day late than a daily false alarm on a payload we cannot read."""
    assert not ilm_is_stuck(OVER, BUDGET, {"tagged_count": 5, "timestamp": "nonsense"}, NOW)
    assert not ilm_is_stuck(OVER, BUDGET, {"tagged_count": 5}, NOW)


def test_naive_previous_timestamp_is_read_as_utc():
    naive = (NOW - timedelta(seconds=86400)).replace(tzinfo=None).isoformat()
    assert ilm_is_stuck(OVER, BUDGET, {"tagged_count": 5, "timestamp": naive}, NOW)


def test_the_margin_boundary():
    """10% over is tolerated, a byte past it is not."""
    prev = _tick(16693, 86400)
    assert not ilm_is_stuck(int(BUDGET * 1.10), BUDGET, prev, NOW)
    assert ilm_is_stuck(int(BUDGET * 1.10) + 1, BUDGET, prev, NOW)
