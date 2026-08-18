"""Tests for the security-check branch of the daily infra alert.

The decision matrix is the whole feature, so it is what gets tested:
no key stays quiet, a stale key alerts, a failing check alerts, and a healthy
check stays quiet. Getting the first one wrong would mail every server admin
on every server that took a code-only update.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

import infra_alert
from infra_alert import SECURITY_REDIS_KEY, SECURITY_STALE_HOURS, _check_security, _hours_since


def _iso(hours_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()


class FakeRedis:
    """Just enough Redis for _load_status."""

    def __init__(self, payload=None):
        self._raw = json.dumps(payload) if payload is not None else None

    def get(self, key):
        assert key == SECURITY_REDIS_KEY
        return self._raw


@pytest.fixture
def sent(monkeypatch):
    """Capture what would have been emailed, without touching the DB or Redis."""
    calls = []
    monkeypatch.setattr(infra_alert, "_alert_recipients", lambda: [(1, "admin@example.com")])
    monkeypatch.setattr(
        infra_alert,
        "_queue_email",
        lambda recipients, subject, text_body, html_body, trigger: (
            calls.append({"subject": subject, "text": text_body, "trigger": trigger}) or len(recipients)
        ),
    )
    return calls


class TestHoursSince:
    def test_reads_an_aware_stamp(self):
        assert _hours_since(_iso(3)) == pytest.approx(3, abs=0.1)

    def test_naive_stamp_is_treated_as_utc(self):
        # The host script writes +00:00, but a hand-edited key might not.
        # A naive stamp must not crash the aware arithmetic.
        naive = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
        assert _hours_since(naive) == pytest.approx(0, abs=0.1)

    def test_missing_or_garbage(self):
        assert _hours_since(None) is None
        assert _hours_since("") is None
        assert _hours_since("not-a-date") is None


class TestCheckSecurity:
    def test_no_key_stays_quiet(self, sent):
        # Worker code arrives with a git pull, the cron with ansible. A missing
        # key means ansible has not run yet, not that the server is insecure.
        _check_security(FakeRedis(None), "example.com", True)
        assert sent == []

    def test_healthy_check_stays_quiet(self, sent):
        _check_security(
            FakeRedis({"status": "ok", "timestamp": _iso(2), "passed": 41, "failed": 0}),
            "example.com", True,
        )
        assert sent == []

    def test_failing_check_alerts_and_names_the_failures(self, sent):
        _check_security(
            FakeRedis({
                "status": "fail",
                "timestamp": _iso(2),
                "error": "fail2ban is NOT running; SSH still accepts password logins",
                "passed": 39, "failed": 2, "warnings": 0,
            }),
            "example.com", True,
        )
        assert len(sent) == 1
        assert sent[0]["subject"] == "example.com - Security check failed"
        assert "fail2ban is NOT running" in sent[0]["text"]
        assert "Checks failed: 2" in sent[0]["text"]

    def test_stale_key_alerts_even_when_the_last_result_was_ok(self, sent):
        # The cron died. The last stored answer says everything is fine, which
        # is exactly why staleness has to be judged separately.
        _check_security(
            FakeRedis({"status": "ok", "timestamp": _iso(SECURITY_STALE_HOURS + 5), "passed": 41}),
            "example.com", True,
        )
        assert len(sent) == 1
        assert "last ran" in sent[0]["text"]

    def test_just_inside_the_stale_window_stays_quiet(self, sent):
        # One skipped night must not alert, or the alert becomes noise.
        _check_security(
            FakeRedis({"status": "ok", "timestamp": _iso(SECURITY_STALE_HOURS - 1), "passed": 41}),
            "example.com", True,
        )
        assert sent == []

    def test_toggle_off_stays_quiet(self, sent):
        _check_security(
            FakeRedis({"status": "fail", "timestamp": _iso(1), "error": "ufw is off"}),
            "example.com", False,
        )
        assert sent == []

    def test_missing_status_field_is_treated_as_a_failure(self, sent):
        # Fail closed: a payload we cannot read must not read as healthy.
        _check_security(FakeRedis({"timestamp": _iso(1)}), "example.com", True)
        assert len(sent) == 1
