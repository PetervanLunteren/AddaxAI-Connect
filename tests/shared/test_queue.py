"""Tests for shared.queue constants and the consume loop heartbeat."""
import json

import pytest

from shared.queue import (
    RedisQueue,
    QUEUE_IMAGE_INGESTED,
    QUEUE_DETECTION_COMPLETE,
    QUEUE_FAILED_JOBS,
    QUEUE_NOTIFICATION_EVENTS,
    QUEUE_NOTIFICATION_TELEGRAM,
    QUEUE_NOTIFICATION_EMAIL,
    HEARTBEAT_KEY_NOTIFICATIONS,
    HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
    HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    HEARTBEAT_TICK_SECONDS,
)


def test_queue_names_are_unique():
    """All queue name constants must be distinct strings."""
    names = [
        QUEUE_IMAGE_INGESTED,
        QUEUE_DETECTION_COMPLETE,
        QUEUE_FAILED_JOBS,
        QUEUE_NOTIFICATION_EVENTS,
        QUEUE_NOTIFICATION_TELEGRAM,
        QUEUE_NOTIFICATION_EMAIL,
    ]
    assert len(names) == len(set(names))
    assert all(isinstance(n, str) and n for n in names)


def test_heartbeat_keys_are_unique():
    """Heartbeat keys must be distinct from each other and from queues."""
    keys = [
        HEARTBEAT_KEY_NOTIFICATIONS,
        HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
        HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    ]
    queues = [
        QUEUE_NOTIFICATION_EVENTS,
        QUEUE_NOTIFICATION_TELEGRAM,
        QUEUE_NOTIFICATION_EMAIL,
    ]
    assert len(keys) == len(set(keys))
    assert not set(keys) & set(queues)


class FakeRedisClient:
    """Enough of a Redis client for one consume_forever run. brpop pops
    scripted results (None = idle timeout); the callback raising
    KeyboardInterrupt ends the loop, which consume_forever does not
    catch."""

    def __init__(self, brpop_results):
        self.brpop_results = list(brpop_results)
        self.set_calls = []
        self.brpop_timeouts = []

    def set(self, key, value):
        self.set_calls.append((key, value))

    def brpop(self, queue_name, timeout=0):
        self.brpop_timeouts.append(timeout)
        if not self.brpop_results:
            raise AssertionError("consume loop ran past the scripted results")
        return self.brpop_results.pop(0)


def test_consume_forever_stamps_heartbeat_each_iteration():
    """The loop stamps before consuming: once on the idle tick, once
    before the message that ends the run. The BRPOP timeout is finite so
    an idle worker still returns to the loop top."""
    queue = RedisQueue("test-queue")
    fake = FakeRedisClient([
        None,  # idle tick, BRPOP timed out
        ("test-queue", json.dumps({"x": 1})),
    ])
    queue.client = fake

    def callback(message):
        assert message == {"x": 1}
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        queue.consume_forever(callback, heartbeat_key="heartbeat:test")

    assert len(fake.set_calls) == 2
    assert all(key == "heartbeat:test" for key, _ in fake.set_calls)
    assert fake.brpop_timeouts == [HEARTBEAT_TICK_SECONDS, HEARTBEAT_TICK_SECONDS]


def test_consume_forever_without_heartbeat_never_stamps():
    queue = RedisQueue("test-queue")
    fake = FakeRedisClient([("test-queue", json.dumps({"x": 1}))])
    queue.client = fake

    def callback(message):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        queue.consume_forever(callback)

    assert fake.set_calls == []
