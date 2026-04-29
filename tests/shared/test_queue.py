"""Tests for shared.queue constants."""
from shared.queue import (
    QUEUE_IMAGE_INGESTED,
    QUEUE_DETECTION_COMPLETE,
    QUEUE_FAILED_JOBS,
    QUEUE_NOTIFICATION_EVENTS,
    QUEUE_NOTIFICATION_TELEGRAM,
    QUEUE_NOTIFICATION_EMAIL,
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
