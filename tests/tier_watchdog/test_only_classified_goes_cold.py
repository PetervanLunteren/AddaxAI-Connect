"""The watchdog only moves the raw of an image that is classified.

pwn on 19 Nov 2026: an SD-card import of 15,000 photos went over the 10 GB
budget, the watchdog tagged the oldest objects whatever their state, and
about 3,300 photos were on the remote tier before detection had read them.
Each one then came back from the remote tier per read, and one broken read
failed its image.
"""
import logging
from datetime import datetime, timedelta, timezone

import watchdog

GB = 1024 ** 3
T0 = datetime(2026, 11, 18, 9, 0, tzinfo=timezone.utc)


class _Paginator:
    def __init__(self, objects):
        self.objects = objects

    def paginate(self, Bucket):
        yield {"Contents": self.objects}


class _Client:
    def __init__(self, objects):
        self.objects = objects

    def get_paginator(self, name):
        return _Paginator(self.objects)


class _Storage:
    def __init__(self, objects):
        self.client = _Client(objects)
        self.tagged = []

    def tag_object_cold(self, bucket, key):
        self.tagged.append(key)


def _obj(key, minutes, size=GB, storage_class="STANDARD"):
    return {"Key": key, "Size": size, "StorageClass": storage_class,
            "LastModified": T0 + timedelta(minutes=minutes)}


def _run(monkeypatch, objects, classified, hot_gb, budget_gb="2"):
    storage = _Storage(objects)
    asked = []

    def fake_classified(keys):
        asked.append(list(keys))
        return set(classified)

    monkeypatch.setenv("COLD_TIER_HOT_BUDGET_GB", budget_gb)
    monkeypatch.setattr(watchdog, "hot_bytes", lambda: hot_gb * GB)
    monkeypatch.setattr(watchdog, "classified_keys", fake_classified)
    result = watchdog.tick(storage, logging.getLogger("test"))
    return storage, result, asked


def test_an_unclassified_image_is_never_tagged(monkeypatch):
    """Oldest first, but the oldest object is still waiting for detection."""
    objects = [_obj("waiting", 0), _obj("done-old", 1), _obj("done-new", 2)]
    storage, result, _ = _run(monkeypatch, objects, {"done-old", "done-new"}, hot_gb=3)
    assert storage.tagged == ["done-old"]
    assert result["tagged_count"] == 1


def test_a_backlog_holds_the_disk_over_budget_without_an_alert(monkeypatch):
    objects = [_obj("waiting-1", 0), _obj("waiting-2", 1), _obj("waiting-3", 2)]
    storage, result, _ = _run(monkeypatch, objects, set(), hot_gb=3)
    assert storage.tagged == []
    assert result["status"] == "ok"
    assert "waiting_for_ilm" not in result


def test_an_object_without_an_image_row_is_never_tagged(monkeypatch):
    """Ingestion stores the object before it writes the row. The allow-list
    leaves such an object alone, a skip-list would have let it through."""
    objects = [_obj("no-row-yet", 0), _obj("done", 1)]
    storage, _, _ = _run(monkeypatch, objects, {"done"}, hot_gb=3, budget_gb="1")
    assert storage.tagged == ["done"]


def test_only_hot_objects_are_asked_about(monkeypatch):
    objects = [_obj("cold", 0, storage_class="WASABI_COLD"), _obj("hot", 1)]
    _, _, asked = _run(monkeypatch, objects, {"hot"}, hot_gb=3)
    assert asked == [["hot"]]


def test_under_budget_does_not_ask_the_database(monkeypatch):
    _, result, asked = _run(monkeypatch, [_obj("a", 0)], {"a"}, hot_gb=1)
    assert asked == []
    assert result["status"] == "ok"
