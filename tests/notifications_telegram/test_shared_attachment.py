"""The annotated image belongs to the photo, not to one recipient.

One source photo produces exactly one annotated image in MinIO, but the
notification coordinator fans a detection out to one Telegram message per
species and per subscribed user, and every one of those messages carries the
same annotated_minio_path. A sender that removes the object after its own
send therefore steals the attachment from everyone still queued: the first
recipient got a photo and the rest got text only, silently, because the
download failure is caught and logged as a warning.

That is what broke image attachments on a server with two Telegram
subscribers. These tests pin the contract so it cannot drift back: sending a
notification must leave the attachment in place. Cleanup is MinIO's job, via
the lifecycle rule on the annotated/ prefix in services/minio-init.
"""
import os
import sys

import pytest

_TELEGRAM = os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "notifications-telegram"
)
if _TELEGRAM not in sys.path:
    sys.path.insert(0, _TELEGRAM)

import worker  # noqa: E402

ATTACHMENT = "annotated/11111111-2222-3333-4444-555555555555.jpg"


class FakeStorage:
    """Minimal stand-in for StorageClient, backed by a dict shared by all
    instances so it behaves like one bucket across calls."""

    objects: dict = {}
    deleted: list = []

    def download_fileobj(self, bucket: str, object_name: str) -> bytes:
        try:
            return self.objects[(bucket, object_name)]
        except KeyError:
            raise Exception(f"NoSuchKey: {bucket}/{object_name}")

    def delete_object(self, bucket: str, object_name: str) -> None:
        self.deleted.append((bucket, object_name))
        self.objects.pop((bucket, object_name), None)


class FakeTelegramClient:
    """Records what was sent so the test can assert on the photo bytes."""

    sent: list = []

    def send_message(self, chat_id, text, photo_bytes=None, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "photo_bytes": photo_bytes})


@pytest.fixture
def telegram(monkeypatch):
    """Point the worker at the fakes and hand back the recorders."""
    FakeStorage.objects = {("thumbnails", ATTACHMENT): b"annotated-jpeg-bytes"}
    FakeStorage.deleted = []
    FakeTelegramClient.sent = []

    monkeypatch.setattr(worker, "StorageClient", FakeStorage)
    monkeypatch.setattr(worker, "TelegramClient", FakeTelegramClient)
    monkeypatch.setattr(worker, "update_notification_status", lambda *a, **k: None)
    return FakeStorage, FakeTelegramClient


def _message(log_id: int, chat_id: str, attachment=ATTACHMENT) -> dict:
    return {
        "notification_log_id": log_id,
        "chat_id": chat_id,
        "message_text": "*Fox detected!*",
        "annotated_minio_path": attachment,
        "reply_markup": None,
    }


def test_second_recipient_still_gets_the_photo(telegram):
    """Two subscribers, one photo. Both must receive the image."""
    storage, client = telegram

    worker.process_telegram_message(_message(1, "1111111"))
    worker.process_telegram_message(_message(2, "2222222"))

    assert len(client.sent) == 2
    assert client.sent[0]["photo_bytes"] == b"annotated-jpeg-bytes"
    assert client.sent[1]["photo_bytes"] == b"annotated-jpeg-bytes", (
        "the second recipient lost the attachment, so something deleted or "
        "consumed the shared annotated image after the first send"
    )


def test_sending_does_not_delete_the_attachment(telegram):
    """The sender must not remove an object it does not own."""
    storage, _ = telegram

    worker.process_telegram_message(_message(1, "1111111"))

    assert storage.deleted == [], f"sender deleted {storage.deleted}"
    assert ("thumbnails", ATTACHMENT) in storage.objects


def test_missing_attachment_still_sends_text(telegram):
    """A missing object must not stop the message going out."""
    storage, client = telegram
    storage.objects.clear()

    worker.process_telegram_message(_message(1, "1111111"))

    assert len(client.sent) == 1
    assert client.sent[0]["photo_bytes"] is None


def test_message_without_attachment_is_fine(telegram):
    """Not every notification has an image."""
    _, client = telegram

    worker.process_telegram_message(_message(1, "1111111", attachment=None))

    assert len(client.sent) == 1
    assert client.sent[0]["photo_bytes"] is None
