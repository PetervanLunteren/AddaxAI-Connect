"""The earthranger channel: queueing, and the branch in each notify function.

Everything at the DB and queue boundary is stubbed. The payload shape
itself is covered by tests/shared/test_earthranger.py; here the checks are
that the notify functions hand the right facts to the builder, that a
missing integration or location skips the channel without counting as
delivered, and that the queued message carries the log id and attachment.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

import earthranger_channel as er
import detection_alerts as da
import camera_alerts as ca
import theft_watch as tw

CAPTURED_AT = datetime(2026, 8, 9, 14, 30, 0)  # naive camera clock
AMS = ZoneInfo("Europe/Amsterdam")


class FakeQueue:
    def __init__(self):
        self.published = []

    def publish(self, message):
        self.published.append(message)


def _stub_channel(monkeypatch, enabled=True):
    """Stub the channel's own boundaries and return what it recorded."""
    queue = FakeQueue()
    logs = []

    def fake_log(**kwargs):
        logs.append(kwargs)
        return 42

    monkeypatch.setattr(er, "enabled_integration", lambda db, pid: object() if enabled else None)
    monkeypatch.setattr(er, "create_notification_log", fake_log)
    monkeypatch.setattr(er, "get_queue", lambda: queue)
    return queue, logs


class TestQueueEvent:
    def test_disabled_integration_skips_without_logging(self, monkeypatch):
        queue, logs = _stub_channel(monkeypatch, enabled=False)
        ok = er.queue_event(
            None, project_id=1, rule_id=2, user_id=3,
            notification_type="species_detection", trigger_data={},
            event={"title": "x"},
        )
        assert ok is False
        assert logs == []
        assert queue.published == []

    def test_logs_and_publishes(self, monkeypatch):
        queue, logs = _stub_channel(monkeypatch)
        event = {"title": "Wolf at North gate", "event_type": "addaxai_detection"}
        ok = er.queue_event(
            None, project_id=1, rule_id=2, user_id=3,
            notification_type="species_detection", trigger_data={"rule_id": 2},
            event=event, attachment_minio_path="annotated/abc.jpg",
        )
        assert ok is True
        assert logs[0]["channel"] == "earthranger"
        assert logs[0]["user_id"] == 3
        assert logs[0]["notification_type"] == "species_detection"
        assert '"Wolf at North gate"' in logs[0]["message_content"]
        assert queue.published == [{
            "notification_log_id": 42,
            "project_id": 1,
            "event": event,
            "attachment_minio_path": "annotated/abc.jpg",
        }]


class TestImageLink:
    def test_deep_link(self):
        assert er.image_link("connect.example.org", 5, "img-1") == (
            "https://connect.example.org/projects/5/images?image=img-1"
        )


# ---- detection alerts ----

def _rule(**overrides):
    base = dict(id=9, channels=["earthranger"], species=["wolf"], site_ids=None,
                hour_from=None, hour_to=None, min_group_size=None,
                cooldown_minutes=None, rarity_days=None, cooldown_state={})
    base.update(overrides)
    return SimpleNamespace(**base)


def _user():
    return SimpleNamespace(id=7, email="user@example.com", is_superuser=False)


def _project():
    return SimpleNamespace(id=1, name="Test project", blur_people=True, blur_vehicles=True,
                           blur_categories=lambda: ["person", "vehicle"])


def _event(**overrides):
    base = dict(
        event_type="species_detection", project_id=1, image_uuid="img-1",
        camera_id=3, camera_name="CAM-003", camera_location={"lat": 52.1, "lon": 5.2},
        species="wolf", confidence=0.91, species_count=2,
        annotated_minio_path="annotated/img-1.jpg",
    )
    base.update(overrides)
    return base


def _stub_detection(monkeypatch):
    sent = []

    def fake_queue_event(db, **kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(er, "queue_event", fake_queue_event)
    monkeypatch.setattr(er, "site_location", lambda db, sid: (51.0, 4.0))
    monkeypatch.setattr(er, "scientific_name", lambda db, s: "Canis lupus")
    monkeypatch.setattr(da, "get_server_timezone", lambda db: AMS)
    monkeypatch.setattr(da.settings, "domain_name", "connect.example.org")
    return sent


class TestDetectionBranch:
    def test_builds_event_from_image_facts(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        delivered = da._notify_rule(
            None, None, None, _rule(), _user(), _project(), _event(),
            CAPTURED_AT, 4, "North gate",
        )
        assert delivered is True
        assert len(sent) == 1
        call = sent[0]
        assert call["notification_type"] == "species_detection"
        assert call["user_id"] == 7
        assert call["attachment_minio_path"] == "annotated/img-1.jpg"
        event = call["event"]
        assert event["source"] == "CAM-003"
        assert event["title"] == "Wolf at North gate"
        assert event["recorded_at"] == "2026-08-09T14:30:00+02:00"
        assert event["location"] == {"lat": 52.1, "lon": 5.2}
        assert event["event_details"]["scientific_name"] == "Canis lupus"
        assert event["event_details"]["count"] == 2
        assert event["event_details"]["confidence"] == 0.91
        assert event["event_details"]["image_url"] == (
            "https://connect.example.org/projects/1/images?image=img-1"
        )

    def test_falls_back_to_site_location(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        da._notify_rule(
            None, None, None, _rule(), _user(), _project(),
            _event(camera_location=None), CAPTURED_AT, 4, "North gate",
        )
        assert sent[0]["event"]["location"] == {"lat": 51.0, "lon": 4.0}

    def test_no_location_anywhere_is_not_delivered(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        monkeypatch.setattr(er, "site_location", lambda db, sid: (None, None))
        delivered = da._notify_rule(
            None, None, None, _rule(), _user(), _project(),
            _event(camera_location=None), CAPTURED_AT, None, None,
        )
        assert delivered is False
        assert sent == []

    def test_no_capture_time_is_not_delivered(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        delivered = da._notify_rule(
            None, None, None, _rule(), _user(), _project(), _event(),
            None, 4, "North gate",
        )
        assert delivered is False
        assert sent == []

    def test_disabled_integration_is_not_delivered(self, monkeypatch):
        _stub_detection(monkeypatch)
        monkeypatch.setattr(er, "queue_event", lambda db, **kw: False)
        delivered = da._notify_rule(
            None, None, None, _rule(), _user(), _project(), _event(),
            CAPTURED_AT, 4, "North gate",
        )
        assert delivered is False


# ---- camera condition alerts ----

class TestCameraBranch:
    def test_one_event_per_camera_at_its_site(self, monkeypatch):
        sent = []
        monkeypatch.setattr(er, "queue_event", lambda db, **kw: sent.append(kw) or True)
        monkeypatch.setattr(
            er, "camera_site",
            lambda db, cid: {11: ("Gate", 1.0, 2.0), 12: (None, None, None)}[cid],
        )
        monkeypatch.setattr(ca, "get_camera_site_label", lambda cid: "Gate")
        monkeypatch.setattr(ca.settings, "domain_name", "connect.example.org")
        rule = SimpleNamespace(id=5, rule_type="battery_low", threshold=20, channels=["earthranger"])
        states = {
            11: ca.CamState(device_id="CAM-011", battery_percent=12, sd_utilization_percent=None, last_seen=None),
            12: ca.CamState(device_id="CAM-012", battery_percent=8, sd_utilization_percent=None, last_seen=None),
        }
        delivered = ca._notify(
            None, None, None, rule, _user(), _project(), states, [11, 12], date(2026, 8, 9),
        )
        # Camera 12 has no site and no coordinates, so only camera 11 goes out
        assert delivered is True
        assert len(sent) == 1
        event = sent[0]["event"]
        assert event["source"] == "CAM-011"
        assert event["event_type"] == "addaxai_camera_alert"
        assert event["location"] == {"lat": 1.0, "lon": 2.0}
        assert event["event_details"]["alert"] == "battery_low"
        assert "CAM-011" in event["event_details"]["summary"]
        assert sent[0]["trigger_data"]["camera_id"] == 11
        assert sent[0]["notification_type"] == "camera_alert"


# ---- theft watch ----

class TestTheftWatchBranches:
    def test_person_event_uses_capture_time_and_attachment(self, monkeypatch):
        sent = []
        monkeypatch.setattr(er, "queue_event", lambda db, **kw: sent.append(kw) or True)
        monkeypatch.setattr(er, "site_location", lambda db, sid: (None, None))
        monkeypatch.setattr(tw, "get_server_timezone", lambda db: AMS)
        monkeypatch.setattr(tw.settings, "domain_name", "connect.example.org")
        rule = SimpleNamespace(id=3, sensitivity="medium", channels=["earthranger"])
        delivered = tw._notify_person(
            None, None, None, rule, _user(), _project(),
            _event(species="person"), CAPTURED_AT, 4, "North gate",
            0.3, None, 12, thumbnail_path="thumb/img-1.jpg",
        )
        assert delivered is True
        event = sent[0]["event"]
        assert event["event_details"]["alert"] == "theft_watch_person"
        assert event["recorded_at"] == "2026-08-09T14:30:00+02:00"
        assert event["location"] == {"lat": 52.1, "lon": 5.2}
        assert sent[0]["attachment_minio_path"] == "annotated/img-1.jpg"
        assert sent[0]["notification_type"] == "theft_watch_person"

    def test_silence_event_per_camera_from_state(self, monkeypatch):
        sent = []
        monkeypatch.setattr(er, "queue_event", lambda db, **kw: sent.append(kw) or True)
        monkeypatch.setattr(tw.settings, "domain_name", "connect.example.org")
        rule = SimpleNamespace(id=3, sensitivity="medium", channels=["earthranger"])
        state = tw.WatchCamState(
            device_id="CAM-021", site_id=4, site_name="Ridge", lat=3.0, lon=4.0,
            dep_start=None, battery_percent=50, last_contact=None,
            gap_hours=[1.0, 1.0], silence_hours=30.0,
        )
        delivered = tw._notify_silence(
            None, None, None, rule, _user(), _project(), {21: state}, [21], [21],
        )
        assert delivered is True
        event = sent[0]["event"]
        assert event["source"] == "CAM-021"
        assert event["event_details"]["alert"] == "theft_watch_silence"
        assert event["event_details"]["site"] == "Ridge"
        assert event["location"] == {"lat": 3.0, "lon": 4.0}
        assert sent[0]["notification_type"] == "theft_watch_silence"
