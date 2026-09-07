"""The Sensing Clues worker: one message in, one observation out, outcome recorded.

Cluey, storage and the database are stubbed at the worker's own seams, so
these tests exercise the shipped code path: the missing account, the
missing group id, the observation post, the downscaled attachment, and
what lands on the log and integration rows for each outcome.
"""
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

import worker
from shared.sensingclues import SensingCluesError


class FakeClient:
    def __init__(self):
        self.observations = []
        self.images = []
        self.fail_observation = None  # set to make the next post fail
        self.fail_image = None

    def create_observation(self, group_id, observation):
        if self.fail_observation:
            raise self.fail_observation
        self.observations.append((group_id, observation))
        return "n978ec2a438c68b97"

    def attach_image(self, alert_id, filename, data):
        if self.fail_image:
            raise self.fail_image
        self.images.append((alert_id, filename, data))


@pytest.fixture
def spies(monkeypatch):
    """Stub every boundary and hand back what was recorded."""
    rec = SimpleNamespace(
        statuses=[], successes=[], failures=[], client=FakeClient(),
        available=True, group_id=3523928, attachment=b"jpeg",
    )
    monkeypatch.setattr(worker, "is_available", lambda settings: rec.available)
    monkeypatch.setattr(worker, "get_client", lambda: rec.client)
    monkeypatch.setattr(worker, "load_group_id", lambda pid: rec.group_id)
    monkeypatch.setattr(worker, "record_success", lambda pid: rec.successes.append(pid))
    monkeypatch.setattr(worker, "record_failure", lambda pid, err: rec.failures.append((pid, err)))
    monkeypatch.setattr(
        worker, "update_notification_status",
        lambda log_id, status, error_message=None: rec.statuses.append((log_id, status, error_message)),
    )
    monkeypatch.setattr(worker, "download_attachment", lambda path: rec.attachment)
    monkeypatch.setattr(worker, "downscale", lambda data: b"small")
    return rec


def _message(**overrides):
    base = dict(
        notification_log_id=42, project_id=1,
        event={"id": "abc", "observation_type": "animal_sighting", "description": "Wolf at North gate"},
        attachment_minio_path="annotated/img-1.jpg",
    )
    base.update(overrides)
    return base


def test_observation_and_image_are_posted_and_recorded(spies):
    worker.process_message(_message())
    assert spies.client.observations == [(3523928, _message()["event"])]
    assert spies.client.images == [("n978ec2a438c68b97", "img-1.jpg", b"small")]
    assert spies.statuses == [(42, "sent", None)]
    assert spies.successes == [1]
    assert spies.failures == []


def test_no_attachment_path_posts_observation_only(spies):
    worker.process_message(_message(attachment_minio_path=None))
    assert len(spies.client.observations) == 1
    assert spies.client.images == []
    assert spies.statuses == [(42, "sent", None)]


def test_missing_attachment_still_counts_as_sent(spies):
    spies.attachment = None
    worker.process_message(_message())
    assert spies.client.images == []
    assert spies.statuses == [(42, "sent", None)]
    assert spies.successes == [1]


def test_image_failure_is_not_a_failed_delivery(spies):
    spies.client.fail_image = SensingCluesError("Sensing Clues returned 500: boom", status=500)
    worker.process_message(_message())
    assert len(spies.client.observations) == 1
    assert spies.statuses == [(42, "sent", None)]
    assert spies.failures == []


def test_unreadable_image_is_not_a_failed_delivery(spies, monkeypatch):
    def broken(data):
        raise OSError("cannot identify image file")

    monkeypatch.setattr(worker, "downscale", broken)
    worker.process_message(_message())
    assert spies.client.images == []
    assert spies.statuses == [(42, "sent", None)]


def test_observation_failure_marks_log_and_integration(spies):
    spies.client.fail_observation = SensingCluesError(
        "Sensing Clues returned 404: USER 'addax_service' IS NOT A MEMBER OF PROJECT 1", status=404,
    )
    worker.process_message(_message())
    assert spies.client.images == []
    assert spies.statuses[0][:2] == (42, "failed")
    assert "NOT A MEMBER" in spies.statuses[0][2]
    assert spies.failures[0][0] == 1
    assert spies.successes == []


def test_missing_group_id_fails_without_posting(spies):
    spies.group_id = None
    worker.process_message(_message())
    assert spies.client.observations == []
    assert spies.statuses[0][:2] == (42, "failed")
    assert "not enabled" in spies.statuses[0][2]
    assert spies.failures == []


def test_missing_server_account_fails_without_posting(spies):
    spies.available = False
    worker.process_message(_message())
    assert spies.client.observations == []
    assert spies.statuses == [(42, "failed", "Sensing Clues is not enabled on this server")]


def test_invalid_message_is_dropped(spies):
    worker.process_message({"project_id": 1})
    worker.process_message(_message(event="not a dict"))
    assert spies.client.observations == []
    assert spies.statuses == []


def test_client_is_built_once(monkeypatch):
    built = []
    monkeypatch.setattr(worker, "_client", None)
    monkeypatch.setattr(worker, "client_from_settings", lambda settings: built.append(settings) or object())
    first = worker.get_client()
    assert worker.get_client() is first
    assert len(built) == 1


def _jpeg(width, height, mode="RGB"):
    buf = BytesIO()
    Image.new(mode, (width, height), (10, 20, 30, 255) if mode == "RGBA" else (10, 20, 30)).save(
        buf, format="PNG" if mode == "RGBA" else "JPEG",
    )
    return buf.getvalue()


class TestDownscale:
    def test_longest_side_becomes_800_and_jpeg(self):
        out = Image.open(BytesIO(worker.downscale(_jpeg(1280, 960))))
        assert out.format == "JPEG"
        assert out.size == (800, 600)

    def test_small_image_is_not_enlarged(self):
        out = Image.open(BytesIO(worker.downscale(_jpeg(400, 300))))
        assert out.size == (400, 300)

    def test_rgba_is_converted(self):
        out = Image.open(BytesIO(worker.downscale(_jpeg(1000, 500, mode="RGBA"))))
        assert out.format == "JPEG"
        assert out.mode == "RGB"
        assert out.size == (800, 400)
