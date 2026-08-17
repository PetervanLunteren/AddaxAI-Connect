"""Tests for shared.queue constants and the consume loop heartbeat."""
import json

import pytest

from shared.queue import (
    RedisQueue,
    QUEUE_IMAGE_INGESTED,
    QUEUE_IMAGE_INGESTED_BULK,
    QUEUE_DETECTION_COMPLETE,
    QUEUE_FAILED_JOBS,
    QUEUE_NOTIFICATION_EVENTS,
    QUEUE_NOTIFICATION_TELEGRAM,
    QUEUE_NOTIFICATION_EMAIL,
    HEARTBEAT_KEY_INGESTION,
    HEARTBEAT_KEY_DETECTION,
    HEARTBEAT_KEY_CLASSIFICATION,
    HEARTBEAT_KEY_NOTIFICATIONS,
    HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
    HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    HEARTBEAT_TICK_SECONDS,
    parse_heartbeat,
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
    """Heartbeat keys must be distinct from each other and from queues.

    Two workers sharing a key would make one of them look alive whenever
    the other ticks, which is the failure this whole mechanism exists to
    prevent.
    """
    keys = [
        HEARTBEAT_KEY_INGESTION,
        HEARTBEAT_KEY_DETECTION,
        HEARTBEAT_KEY_CLASSIFICATION,
        HEARTBEAT_KEY_NOTIFICATIONS,
        HEARTBEAT_KEY_NOTIFICATIONS_EMAIL,
        HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM,
    ]
    queues = [
        QUEUE_IMAGE_INGESTED,
        QUEUE_DETECTION_COMPLETE,
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


PRIORITY = [QUEUE_IMAGE_INGESTED, QUEUE_IMAGE_INGESTED_BULK]


def test_consume_forever_priority_stamps_heartbeat_each_iteration():
    """Detection and both classifiers consume through the priority loop,
    so it has to heartbeat exactly like consume_forever does. The finite
    BRPOP timeout is the load-bearing half: it was 0 (block forever)
    before, which would have left an idle worker looking dead after 15
    minutes."""
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)
    fake = FakeRedisClient([
        None,  # idle tick, BRPOP timed out
        (QUEUE_IMAGE_INGESTED, json.dumps({"x": 1})),
    ])
    queue.client = fake

    def callback(message):
        assert message == {"x": 1}
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        queue.consume_forever_priority(
            PRIORITY, callback, heartbeat_key=HEARTBEAT_KEY_DETECTION
        )

    assert len(fake.set_calls) == 2
    assert all(key == HEARTBEAT_KEY_DETECTION for key, _ in fake.set_calls)
    assert fake.brpop_timeouts == [HEARTBEAT_TICK_SECONDS, HEARTBEAT_TICK_SECONDS]


def test_consume_forever_priority_without_heartbeat_never_stamps():
    """The bulk-upload worker passes no key and must keep working."""
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)
    fake = FakeRedisClient([(QUEUE_IMAGE_INGESTED, json.dumps({"x": 1}))])
    queue.client = fake

    def callback(message):
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        queue.consume_forever_priority(PRIORITY, callback)

    assert fake.set_calls == []


def test_stamp_heartbeat_round_trips_through_parse_heartbeat():
    """The writer and the reader have to agree. An unparseable stamp
    reads as "never seen" and would alert on a healthy worker."""
    queue = RedisQueue("test-queue")
    fake = FakeRedisClient([])
    queue.client = fake

    queue.stamp_heartbeat(HEARTBEAT_KEY_INGESTION)

    (key, value), = fake.set_calls
    assert key == HEARTBEAT_KEY_INGESTION
    parsed = parse_heartbeat(value)
    assert parsed is not None
    assert parsed.tzinfo is not None  # aware, or the staleness maths raises
