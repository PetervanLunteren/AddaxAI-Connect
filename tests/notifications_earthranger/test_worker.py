"""The EarthRanger worker: one message in, one Gundi event out, outcome recorded.

Gundi, storage and the database are stubbed at the worker's own seams, so
these tests exercise the shipped code path: the dev guard, the missing key,
the event post, the attachment, and what lands on the log and integration
rows for each outcome.
"""
from types import SimpleNamespace

import pytest

import worker
from shared.earthranger import GundiError


class FakeClient:
    instances = []
    fail_event = None        # set on the class to make the next post fail
    fail_attachment = None

    def __init__(self, api_key):
        self.api_key = api_key
        self.events = []
        self.attachments = []
        FakeClient.instances.append(self)

    def create_event(self, payload):
        if self.fail_event:
            raise self.fail_event
        self.events.append(payload)
        return "obj-1"

    def attach_file(self, object_id, filename, data):
        if self.fail_attachment:
            raise self.fail_attachment
        self.attachments.append((object_id, filename, data))


@pytest.fixture
def spies(monkeypatch):
    """Stub every boundary and hand back what was recorded."""
    FakeClient.instances = []
    FakeClient.fail_event = None
    FakeClient.fail_attachment = None
    rec = SimpleNamespace(statuses=[], successes=[], failures=[], api_key="key-1",
                          attachment=b"jpeg", allowed=(True, ""))

    monkeypatch.setattr(worker, "GundiClient", FakeClient)
    monkeypatch.setattr(worker, "earthranger_allowed", lambda pid: rec.allowed)
    monkeypatch.setattr(worker, "load_api_key", lambda pid: rec.api_key)
    monkeypatch.setattr(worker, "record_success", lambda pid: rec.successes.append(pid))
    monkeypatch.setattr(worker, "record_failure", lambda pid, err: rec.failures.append((pid, err)))
    monkeypatch.setattr(
        worker, "update_notification_status",
        lambda log_id, status, error_message=None: rec.statuses.append((log_id, status, error_message)),
    )
    monkeypatch.setattr(worker, "download_attachment", lambda path: rec.attachment)
    return rec


def _message(**overrides):
    base = dict(
        notification_log_id=42, project_id=1,
        event={"title": "Wolf at North gate", "event_type": "addaxai_detection"},
        attachment_minio_path="annotated/img-1.jpg",
    )
    base.update(overrides)
    return base


def test_event_and_attachment_are_posted_and_recorded(spies):
    worker.process_message(_message())
    client = FakeClient.instances[0]
    assert client.api_key == "key-1"
    assert client.events == [{"title": "Wolf at North gate", "event_type": "addaxai_detection"}]
    assert client.attachments == [("obj-1", "img-1.jpg", b"jpeg")]
    assert spies.statuses == [(42, "sent", None)]
    assert spies.successes == [1]
    assert spies.failures == []


def test_no_attachment_path_posts_event_only(spies):
    worker.process_message(_message(attachment_minio_path=None))
    assert FakeClient.instances[0].attachments == []
    assert spies.statuses == [(42, "sent", None)]


def test_missing_attachment_still_counts_as_sent(spies):
    spies.attachment = None
    worker.process_message(_message())
    assert FakeClient.instances[0].attachments == []
    assert spies.statuses == [(42, "sent", None)]


def test_attachment_failure_is_not_a_failed_delivery(spies):
    FakeClient.fail_attachment = GundiError("boom", status=500)
    worker.process_message(_message())
    assert spies.statuses == [(42, "sent", None)]
    assert spies.failures == []


def test_event_failure_marks_log_and_integration(spies):
    FakeClient.fail_event = GundiError("Gundi returned 403: bad key", status=403)
    worker.process_message(_message())
    assert spies.statuses == [(42, "failed", "Gundi returned 403: bad key")]
    assert spies.failures == [(1, "Gundi returned 403: bad key")]
    assert spies.successes == []


def test_blocked_on_development_server(spies):
    spies.allowed = (False, "development server, project is not in DEV_NOTIFY_EARTHRANGER_PROJECTS")
    worker.process_message(_message())
    assert FakeClient.instances == []
    assert spies.statuses == [(42, "blocked", spies.allowed[1])]


def test_missing_key_fails_without_posting(spies):
    spies.api_key = None
    worker.process_message(_message())
    assert FakeClient.instances == []
    assert spies.statuses[0][0:2] == (42, "failed")
    assert "not enabled" in spies.statuses[0][2]


def test_invalid_message_is_dropped(spies):
    worker.process_message({"project_id": 1})
    assert FakeClient.instances == []
    assert spies.statuses == []
