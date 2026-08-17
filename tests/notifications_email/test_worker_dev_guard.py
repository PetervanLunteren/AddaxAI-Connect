"""The email worker must not hand a blocked message to SMTP.

test_notify_guard.py proves the rule. This proves the worker obeys it, which
is the part that actually protects real users. The worker is loaded from source
with its two dependencies stubbed, so this exercises the shipped code path
rather than a copy of it that could drift.
"""
import importlib.util
import sys
import types
from pathlib import Path

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[2] / "services" / "notifications-email"


@pytest.fixture
def worker(monkeypatch):
    """Import worker.py with email_client and db_operations replaced by spies.

    aiosmtplib and a live database are not available here, and neither is
    needed: what matters is whether send is reached at all.
    """
    sent = []
    statuses = []

    fake_client = types.SimpleNamespace(
        send_email_sync=lambda **kw: sent.append(kw),
        _validate_config=lambda: None,
    )
    email_client_mod = types.ModuleType("email_client")
    email_client_mod.get_email_client = lambda: fake_client

    db_mod = types.ModuleType("db_operations")
    db_mod.update_notification_status = (
        lambda log_id, status, error_message=None: statuses.append(
            (log_id, status, error_message)
        )
    )

    monkeypatch.setitem(sys.modules, "email_client", email_client_mod)
    monkeypatch.setitem(sys.modules, "db_operations", db_mod)

    spec = importlib.util.spec_from_file_location(
        "_email_worker_under_test", SERVICE_DIR / "worker.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    mod._sent = sent
    mod._statuses = statuses
    return mod


def _message(to_email="ranger@example.org"):
    return {
        "notification_log_id": 42,
        "to_email": to_email,
        "subject": "Daily report",
        "body_text": "body",
        "body_html": None,
    }


def _set_env(worker, monkeypatch, environment, allow=""):
    fake = types.SimpleNamespace(
        environment=environment,
        dev_notify_emails=allow,
        dev_notify_chat_ids="",
    )
    # The guard reads settings through its own module-level import.
    from shared import notify_guard
    monkeypatch.setattr(notify_guard, "get_settings", lambda: fake)


def test_production_still_sends(worker, monkeypatch):
    """The regression that would matter most: a silenced production server."""
    _set_env(worker, monkeypatch, "production")
    worker.process_email_message(_message())
    assert len(worker._sent) == 1
    assert worker._sent[0]["to_email"] == "ranger@example.org"
    assert ("sent" in s for s in worker._statuses)


def test_dev_does_not_reach_smtp(worker, monkeypatch):
    _set_env(worker, monkeypatch, "development", allow="peter@addaxdatascience.com")
    worker.process_email_message(_message("ranger@example.org"))
    assert worker._sent == [], "a blocked message was handed to SMTP anyway"


def test_dev_records_why_it_was_blocked(worker, monkeypatch):
    _set_env(worker, monkeypatch, "development", allow="peter@addaxdatascience.com")
    worker.process_email_message(_message("ranger@example.org"))
    assert len(worker._statuses) == 1
    log_id, status, reason = worker._statuses[0]
    assert log_id == 42
    assert status == "blocked"
    assert reason, "a blocked row with no reason is useless when reading logs later"


def test_dev_still_sends_to_the_allow_list(worker, monkeypatch):
    """Fire drills on dev have to keep working."""
    _set_env(worker, monkeypatch, "development", allow="peter@addaxdatascience.com")
    worker.process_email_message(_message("peter@addaxdatascience.com"))
    assert len(worker._sent) == 1
