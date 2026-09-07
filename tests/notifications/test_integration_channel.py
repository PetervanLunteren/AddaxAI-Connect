"""The project channels: queueing, and the branch in each notify function.

Everything at the DB and queue boundary is stubbed. The payload shapes
themselves are covered by tests/shared/test_earthranger.py and
test_sensingclues.py; here the checks are that the notify functions hand
the right facts to the right builder for the rule's channel, that a
missing integration or location skips the channel without counting as
delivered, and that the queued message carries the log id and attachment.
"""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

import integration_channel as ic
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
    queues = {}
    logs = []

    def fake_log(**kwargs):
        logs.append(kwargs)
        return 42

    monkeypatch.setattr(ic, "enabled_integration", lambda db, kind, pid: object() if enabled else None)
    monkeypatch.setattr(ic, "create_notification_log", fake_log)
    monkeypatch.setattr(ic, "get_queue", lambda kind: queues.setdefault(kind, FakeQueue()))
    return queues, logs


class TestQueueEvent:
    def test_disabled_integration_skips_without_logging(self, monkeypatch):
        queues, logs = _stub_channel(monkeypatch, enabled=False)
        ok = ic.queue_event(
            None, kind="earthranger", project_id=1, rule_id=2, user_id=3,
            notification_type="species_detection", trigger_data={},
            event={"title": "x"},
        )
        assert ok is False
        assert logs == []
        assert queues == {}

    def test_logs_and_publishes(self, monkeypatch):
        queues, logs = _stub_channel(monkeypatch)
        event = {"title": "Wolf at North gate", "event_type": "addaxai_connect_detection"}
        ok = ic.queue_event(
            None, kind="earthranger", project_id=1, rule_id=2, user_id=3,
            notification_type="species_detection", trigger_data={"rule_id": 2},
            event=event, attachment_minio_path="annotated/abc.jpg",
        )
        assert ok is True
        assert logs[0]["channel"] == "earthranger"
        assert logs[0]["user_id"] == 3
        assert logs[0]["notification_type"] == "species_detection"
        assert '"Wolf at North gate"' in logs[0]["message_content"]
        assert queues["earthranger"].published == [{
            "notification_log_id": 42,
            "project_id": 1,
            "event": event,
            "attachment_minio_path": "annotated/abc.jpg",
        }]

    def test_routes_by_kind(self, monkeypatch):
        queues, logs = _stub_channel(monkeypatch)
        ic.queue_event(
            None, kind="sensingclues", project_id=1, rule_id=2, user_id=3,
            notification_type="species_detection", trigger_data={}, event={"id": "x"},
        )
        assert logs[0]["channel"] == "sensingclues"
        assert list(queues) == ["sensingclues"]

    def test_unknown_kind_has_no_queue(self):
        with pytest.raises(KeyError):
            ic.get_queue("sms")

    def test_queue_names(self):
        assert ic.QUEUES == {
            "earthranger": "notification-earthranger",
            "sensingclues": "notification-sensingclues",
        }


class TestImageLink:
    def test_deep_link(self):
        assert ic.image_link("connect.example.org", 5, "img-1") == (
            "https://connect.example.org/projects/5/images?image=img-1"
        )


class TestBuildPayloads:
    def test_camera_payload_dispatches_by_kind(self):
        facts = dict(
            device_id="CAM-1", alert="battery_low", summary="low",
            occurred_at=datetime(2026, 7, 1, 6, 0, tzinfo=timezone.utc),
            lat=1.0, lon=2.0, site_name="Gate", camera_url="https://x",
        )
        assert ic.build_camera_payload("earthranger", facts)["event_type"] == "addaxai_connect_camera_alert"
        observation = ic.build_camera_payload("sensingclues", facts)
        assert observation["observation_type"] == "point_of_interest"
        assert len(observation["id"]) == 32
        with pytest.raises(KeyError):
            ic.build_camera_payload("sms", facts)

    def test_detection_payload_names_the_classifier(self):
        facts = dict(
            device_id="CAM-1", species="wolf", species_display="Wolf",
            captured_at=CAPTURED_AT, tz=AMS, lat=1.0, lon=2.0, site_name="Gate",
            image_url="https://x", count=1, confidence=0.9, scientific_name=None,
        )
        assert ic.build_detection_payload("sensingclues", facts, "speciesnet")["classifier"] == "SpeciesNet v4.0.1"
        assert ic.build_detection_payload("sensingclues", facts, None)["classifier"] == "DeepFaune v1.4"
        assert ic.build_detection_payload("earthranger", facts, None)["event_type"] == "addaxai_connect_detection"


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

    monkeypatch.setattr(ic, "queue_event", fake_queue_event)
    monkeypatch.setattr(ic, "site_location", lambda db, sid: (51.0, 4.0))
    monkeypatch.setattr(ic, "scientific_name", lambda db, s: "Canis lupus")
    monkeypatch.setattr(da, "get_server_timezone", lambda db: AMS)
    monkeypatch.setattr(da.settings, "domain_name", "connect.example.org")
    monkeypatch.setattr(da.settings, "classification_model", "deepfaune")
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
        assert call["kind"] == "earthranger"
        assert call["notification_type"] == "species_detection"
        assert call["user_id"] == 7
        assert call["attachment_minio_path"] == "annotated/img-1.jpg"
        event = call["event"]
        assert event["source"] == "CAM-003"
        assert event["title"] == "Wolf at North gate"
        assert event["recorded_at"] == "2026-08-09T14:30:00+02:00"
        assert event["location"] == {"lat": 52.1, "lon": 5.2}
        assert event["event_details"]["addaxai_connect_scientific_name"] == "Canis lupus"
        assert event["event_details"]["addaxai_connect_count"] == 2
        assert event["event_details"]["addaxai_connect_confidence"] == 0.91
        assert event["event_details"]["addaxai_connect_link"] == (
            "https://connect.example.org/projects/1/images?image=img-1"
        )

    def test_sensingclues_builds_observation(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        delivered = da._notify_rule(
            None, None, None, _rule(channels=["sensingclues"]), _user(), _project(), _event(),
            CAPTURED_AT, 4, "North gate",
        )
        assert delivered is True
        call = sent[0]
        assert call["kind"] == "sensingclues"
        assert call["attachment_minio_path"] == "annotated/img-1.jpg"
        observation = call["event"]
        assert len(observation["id"]) == 32
        assert observation["observation_type"] == "animal_sighting"
        assert observation["description"] == "Wolf at North gate"
        assert observation["timestamp"] == "2026-08-09T14:30:00+02:00"
        assert observation["geometry"]["coordinates"] == [5.2, 52.1]
        assert observation["classifier"] == "DeepFaune v1.4"
        assert observation["values"]["species"] == "Wolf"
        assert observation["values"]["latinName"] == "Canis lupus"
        assert observation["values"]["addaxAI"]["count"] == 2
        assert observation["values"]["addaxAI"]["confidence"] == 0.91
        assert observation["values"]["addaxAI"]["link"] == (
            "https://connect.example.org/projects/1/images?image=img-1"
        )

    def test_sensingclues_person_is_human_activity(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        monkeypatch.setattr(ic, "scientific_name", lambda db, s: None)
        da._notify_rule(
            None, None, None, _rule(channels=["sensingclues"], species=["person"]),
            _user(), _project(), _event(species="person"), CAPTURED_AT, 4, "North gate",
        )
        observation = sent[0]["event"]
        assert observation["observation_type"] == "human_activity"
        assert observation["values"]["transport"] == "On Foot"
        assert "species" not in observation["values"]

    def test_falls_back_to_site_location(self, monkeypatch):
        sent = _stub_detection(monkeypatch)
        da._notify_rule(
            None, None, None, _rule(), _user(), _project(),
            _event(camera_location=None), CAPTURED_AT, 4, "North gate",
        )
        assert sent[0]["event"]["location"] == {"lat": 51.0, "lon": 4.0}

    @pytest.mark.parametrize("kind", ["earthranger", "sensingclues"])
    def test_no_location_anywhere_is_not_delivered(self, monkeypatch, kind):
        sent = _stub_detection(monkeypatch)
        monkeypatch.setattr(ic, "site_location", lambda db, sid: (None, None))
        delivered = da._notify_rule(
            None, None, None, _rule(channels=[kind]), _user(), _project(),
            _event(camera_location=None), CAPTURED_AT, None, None,
        )
        assert delivered is False
        assert sent == []

    @pytest.mark.parametrize("kind", ["earthranger", "sensingclues"])
    def test_no_capture_time_is_not_delivered(self, monkeypatch, kind):
        sent = _stub_detection(monkeypatch)
        delivered = da._notify_rule(
            None, None, None, _rule(channels=[kind]), _user(), _project(), _event(),
            None, 4, "North gate",
        )
        assert delivered is False
        assert sent == []

    def test_disabled_integration_is_not_delivered(self, monkeypatch):
        _stub_detection(monkeypatch)
        monkeypatch.setattr(ic, "queue_event", lambda db, **kw: False)
        delivered = da._notify_rule(
            None, None, None, _rule(), _user(), _project(), _event(),
            CAPTURED_AT, 4, "North gate",
        )
        assert delivered is False


# ---- camera condition alerts ----

def _camera_rule(kind):
    return SimpleNamespace(id=5, rule_type="battery_low", threshold=20, channels=[kind])


def _camera_states():
    return {
        11: ca.CamState(device_id="CAM-011", battery_percent=12, sd_utilization_percent=None, last_seen=None),
        12: ca.CamState(device_id="CAM-012", battery_percent=8, sd_utilization_percent=None, last_seen=None),
    }


def _stub_camera(monkeypatch):
    sent = []
    monkeypatch.setattr(ic, "queue_event", lambda db, **kw: sent.append(kw) or True)
    monkeypatch.setattr(
        ic, "camera_site",
        lambda db, cid: {11: ("Gate", 1.0, 2.0), 12: (None, None, None)}[cid],
    )
    monkeypatch.setattr(ca, "get_camera_site_label", lambda cid: "Gate")
    monkeypatch.setattr(ca.settings, "domain_name", "connect.example.org")
    return sent


class TestCameraBranch:
    def test_one_event_per_camera_at_its_site(self, monkeypatch):
        sent = _stub_camera(monkeypatch)
        delivered = ca._notify(
            None, None, None, _camera_rule("earthranger"), _user(), _project(),
            _camera_states(), [11, 12], date(2026, 8, 9),
        )
        # Camera 12 has no site and no coordinates, so only camera 11 goes out
        assert delivered is True
        assert len(sent) == 1
        assert sent[0]["kind"] == "earthranger"
        event = sent[0]["event"]
        assert event["source"] == "CAM-011"
        assert event["event_type"] == "addaxai_connect_camera_alert"
        assert event["location"] == {"lat": 1.0, "lon": 2.0}
        assert event["event_details"]["addaxai_connect_alert"] == "battery_low"
        assert "CAM-011" in event["event_details"]["addaxai_connect_summary"]
        assert sent[0]["trigger_data"]["camera_id"] == 11
        assert sent[0]["notification_type"] == "camera_alert"

    def test_sensingclues_one_observation_per_camera(self, monkeypatch):
        sent = _stub_camera(monkeypatch)
        delivered = ca._notify(
            None, None, None, _camera_rule("sensingclues"), _user(), _project(),
            _camera_states(), [11, 12], date(2026, 8, 9),
        )
        assert delivered is True
        assert len(sent) == 1
        assert sent[0]["kind"] == "sensingclues"
        observation = sent[0]["event"]
        assert observation["observation_type"] == "point_of_interest"
        assert observation["type"] == "alert"
        assert observation["geometry"]["coordinates"] == [2.0, 1.0]
        assert observation["values"]["addaxAI"]["alert"] == "battery_low"
        assert observation["values"]["addaxAI"]["cameraId"] == "CAM-011"
        assert "CAM-011" in observation["description"]
        assert sent[0]["trigger_data"]["camera_id"] == 11


# ---- theft watch ----

def _watch_state():
    return tw.WatchCamState(
        device_id="CAM-021", site_id=4, site_name="Ridge", lat=3.0, lon=4.0,
        dep_start=None, battery_percent=50, last_contact=None,
        gap_hours=[1.0, 1.0], silence_hours=30.0,
    )


class TestTheftWatchBranches:
    def _stub_person(self, monkeypatch):
        sent = []
        monkeypatch.setattr(ic, "queue_event", lambda db, **kw: sent.append(kw) or True)
        monkeypatch.setattr(ic, "site_location", lambda db, sid: (None, None))
        monkeypatch.setattr(tw, "get_server_timezone", lambda db: AMS)
        monkeypatch.setattr(tw.settings, "domain_name", "connect.example.org")
        return sent

    def test_person_event_uses_capture_time_and_attachment(self, monkeypatch):
        sent = self._stub_person(monkeypatch)
        rule = SimpleNamespace(id=3, sensitivity="medium", channels=["earthranger"])
        delivered = tw._notify_person(
            None, None, None, rule, _user(), _project(),
            _event(species="person"), CAPTURED_AT, 4, "North gate",
            0.3, None, 12, thumbnail_path="thumb/img-1.jpg",
        )
        assert delivered is True
        assert sent[0]["kind"] == "earthranger"
        event = sent[0]["event"]
        assert event["event_details"]["addaxai_connect_alert"] == "theft_watch_person"
        assert event["recorded_at"] == "2026-08-09T14:30:00+02:00"
        assert event["location"] == {"lat": 52.1, "lon": 5.2}
        assert sent[0]["attachment_minio_path"] == "annotated/img-1.jpg"
        assert sent[0]["notification_type"] == "theft_watch_person"

    def test_sensingclues_person_alert(self, monkeypatch):
        sent = self._stub_person(monkeypatch)
        rule = SimpleNamespace(id=3, sensitivity="medium", channels=["sensingclues"])
        delivered = tw._notify_person(
            None, None, None, rule, _user(), _project(),
            _event(species="person"), CAPTURED_AT, 4, "North gate",
            0.3, None, 12, thumbnail_path="thumb/img-1.jpg",
        )
        assert delivered is True
        assert sent[0]["kind"] == "sensingclues"
        observation = sent[0]["event"]
        assert observation["observation_type"] == "point_of_interest"
        assert observation["values"]["addaxAI"]["alert"] == "theft_watch_person"
        assert observation["timestamp"] == "2026-08-09T14:30:00+02:00"
        assert observation["geometry"]["coordinates"] == [5.2, 52.1]
        assert sent[0]["attachment_minio_path"] == "annotated/img-1.jpg"

    @pytest.mark.parametrize("kind", ["earthranger", "sensingclues"])
    def test_silence_event_per_camera_from_state(self, monkeypatch, kind):
        sent = []
        monkeypatch.setattr(ic, "queue_event", lambda db, **kw: sent.append(kw) or True)
        monkeypatch.setattr(tw.settings, "domain_name", "connect.example.org")
        rule = SimpleNamespace(id=3, sensitivity="medium", channels=[kind])
        delivered = tw._notify_silence(
            None, None, None, rule, _user(), _project(), {21: _watch_state()}, [21], [21],
        )
        assert delivered is True
        assert sent[0]["kind"] == kind
        assert sent[0]["notification_type"] == "theft_watch_silence"
        payload = sent[0]["event"]
        if kind == "earthranger":
            assert payload["source"] == "CAM-021"
            assert payload["event_details"]["addaxai_connect_alert"] == "theft_watch_silence"
            assert payload["event_details"]["addaxai_connect_site_name"] == "Ridge"
            assert payload["location"] == {"lat": 3.0, "lon": 4.0}
        else:
            assert payload["values"]["addaxAI"]["alert"] == "theft_watch_silence"
            assert payload["values"]["addaxAI"]["siteName"] == "Ridge"
            assert payload["geometry"]["coordinates"] == [4.0, 3.0]
