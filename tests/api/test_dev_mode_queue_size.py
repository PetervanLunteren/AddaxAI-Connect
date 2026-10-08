"""
The dev-server purge dialog shows how many emails and Telegram messages are
still queued. _queue_size swallows errors and returns 0, so a call to a
method RedisQueue does not have read as "nothing queued" for months. This
runs the real RedisQueue against a fake Redis client, so a renamed method
fails here instead of silently reporting 0.
"""
import os
import sys

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

import shared.queue  # noqa: E402
from routers.admin import _queue_size  # noqa: E402


class _FakeRedis:
    def __init__(self, lengths):
        self._lengths = lengths

    def llen(self, name):
        return self._lengths.get(name, 0)


def test_queue_size_reads_the_real_queue_length(monkeypatch):
    fake = _FakeRedis({"notification-email": 3})
    monkeypatch.setattr(shared.queue.redis, "from_url", lambda *a, **k: fake)
    assert _queue_size("notification-email") == 3
    assert _queue_size("notification-telegram") == 0
