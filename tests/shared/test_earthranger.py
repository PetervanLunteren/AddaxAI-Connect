"""Tests for the EarthRanger (Gundi) payload builders and client parsing."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest

from shared.earthranger import (
    EVENT_TYPE_CAMERA_ALERT,
    EVENT_TYPE_DETECTION,
    GundiClient,
    GundiError,
    build_camera_event,
    build_detection_event,
    build_test_event,
    category_of,
    format_recorded_at,
    parse_object_id,
)

AMS = ZoneInfo("Europe/Amsterdam")


class TestFormatRecordedAt:
    def test_naive_camera_time_gets_server_offset(self):
        # Summer time in Amsterdam is UTC+2; the offset must be in the string
        assert format_recorded_at(datetime(2026, 7, 1, 8, 30), AMS) == "2026-07-01T08:30:00+02:00"

    def test_winter_offset(self):
        assert format_recorded_at(datetime(2026, 1, 1, 8, 30), AMS) == "2026-01-01T08:30:00+01:00"

    def test_aware_passes_through(self):
        moment = datetime(2026, 7, 1, 6, 30, tzinfo=timezone.utc)
        assert format_recorded_at(moment) == "2026-07-01T06:30:00+00:00"

    def test_naive_without_timezone_raises(self):
        with pytest.raises(ValueError):
            format_recorded_at(datetime(2026, 7, 1, 8, 30))


class TestCategoryOf:
    def test_person_and_vehicle(self):
        assert category_of("person") == "person"
        assert category_of("vehicle") == "vehicle"

    def test_anything_else_is_animal(self):
        assert category_of("red fox") == "animal"


def _detection(**overrides):
    kwargs = dict(
        device_id="CAM-012",
        species="red fox",
        species_display="Red fox",
        captured_at=datetime(2026, 7, 1, 8, 30),
        tz=AMS,
        lat=52.1,
        lon=5.2,
        site_name="Site 4",
        image_url="https://connect.example.org/projects/1/images?image=abc",
        count=2,
        confidence=0.87654,
        scientific_name="Vulpes vulpes",
    )
    kwargs.update(overrides)
    return build_detection_event(**kwargs)


class TestBuildDetectionEvent:
    def test_top_level(self):
        event = _detection()
        assert event["source"] == "CAM-012"
        assert event["title"] == "Red fox at Site 4"
        assert event["event_type"] == EVENT_TYPE_DETECTION
        assert event["recorded_at"] == "2026-07-01T08:30:00+02:00"
        assert event["location"] == {"lat": 52.1, "lon": 5.2}

    def test_details(self):
        details = _detection()["event_details"]
        assert details == {
            "addaxai_connect_species": "Red fox",
            "addaxai_connect_category": "animal",
            "addaxai_connect_camera_id": "CAM-012",
            "addaxai_connect_link": "https://connect.example.org/projects/1/images?image=abc",
            "addaxai_connect_scientific_name": "Vulpes vulpes",
            "addaxai_connect_count": 2,
            "addaxai_connect_confidence": 0.88,
            "addaxai_connect_site_name": "Site 4",
        }

    def test_person_category(self):
        details = _detection(species="person", species_display="Person")["event_details"]
        assert details["addaxai_connect_category"] == "person"

    def test_no_site_uses_camera_in_title(self):
        event = _detection(site_name=None)
        assert event["title"] == "Red fox at CAM-012"
        assert "addaxai_connect_site_name" not in event["event_details"]

    def test_optional_fields_omitted(self):
        details = _detection(count=None, confidence=None, scientific_name=None)["event_details"]
        assert "addaxai_connect_count" not in details
        assert "addaxai_connect_confidence" not in details
        assert "addaxai_connect_scientific_name" not in details

    def test_missing_location_raises(self):
        with pytest.raises(ValueError):
            _detection(lat=None)
        with pytest.raises(ValueError):
            _detection(lon=None)


class TestBuildCameraEvent:
    def test_shape(self):
        event = build_camera_event(
            device_id="CAM-012",
            alert="battery_low",
            summary="Battery at 12%",
            occurred_at=datetime(2026, 7, 1, 6, 0, tzinfo=timezone.utc),
            lat=52.1,
            lon=5.2,
            site_name="Site 4",
            camera_url="https://connect.example.org/projects/1/cameras",
        )
        assert event["event_type"] == EVENT_TYPE_CAMERA_ALERT
        assert event["title"] == "Camera alert at Site 4"
        assert event["recorded_at"] == "2026-07-01T06:00:00+00:00"
        assert event["event_details"]["addaxai_connect_alert"] == "battery_low"
        assert event["event_details"]["addaxai_connect_summary"] == "Battery at 12%"
        assert event["event_details"]["addaxai_connect_site_name"] == "Site 4"

    def test_missing_location_raises(self):
        with pytest.raises(ValueError):
            build_camera_event(
                device_id="CAM-012", alert="battery_low", summary="x",
                occurred_at=datetime.now(timezone.utc), lat=None, lon=None,
                site_name=None, camera_url="https://x",
            )


class TestBuildTestEvent:
    def test_says_test(self):
        event = build_test_event(project_name="Demo", lat=1.0, lon=2.0)
        assert event["title"].startswith("Test from AddaxAI Connect")
        assert event["event_type"] == EVENT_TYPE_DETECTION
        assert event["location"] == {"lat": 1.0, "lon": 2.0}
        assert event["recorded_at"].endswith("+00:00")

    def test_no_empty_detail_values(self):
        # EarthRanger's form validates an empty string against the field
        # format (URL for the link), which blocks resolving the event
        event = build_test_event(project_name="Demo", lat=1.0, lon=2.0)
        assert all(value for value in event["event_details"].values())


class TestParseObjectId:
    def test_dict(self):
        assert parse_object_id({"object_id": "abc", "created_at": "x"}) == "abc"

    def test_list_wrapper(self):
        assert parse_object_id([{"object_id": "abc"}]) == "abc"

    def test_missing_raises(self):
        with pytest.raises(GundiError):
            parse_object_id({"ok": True})
        with pytest.raises(GundiError):
            parse_object_id([])


class TestGundiClient:
    def test_empty_key_rejected(self):
        with pytest.raises(ValueError):
            GundiClient("")

    def test_create_event_posts_with_apikey(self, monkeypatch):
        seen = {}

        def fake_post(url, headers=None, timeout=None, json=None, files=None):
            seen.update(url=url, headers=headers, json=json)
            return httpx.Response(200, json={"object_id": "obj-1", "created_at": "now"})

        monkeypatch.setattr(httpx, "post", fake_post)
        client = GundiClient("key-123", base_url="https://gundi.test/v2/")
        assert client.create_event({"title": "x"}) == "obj-1"
        assert seen["url"] == "https://gundi.test/v2/events/"
        assert seen["headers"] == {"apikey": "key-123"}
        assert seen["json"] == {"title": "x"}

    def test_attach_file_uses_attachments_url(self, monkeypatch):
        seen = {}

        def fake_post(url, headers=None, timeout=None, json=None, files=None):
            seen.update(url=url, files=files)
            return httpx.Response(200, json={"object_id": "att-1"})

        monkeypatch.setattr(httpx, "post", fake_post)
        GundiClient("k").attach_file("obj-1", "photo.jpg", b"bytes")
        assert seen["url"] == "https://sensors.api.gundiservice.org/v2/events/obj-1/attachments/"
        assert seen["files"] == {"file1": ("photo.jpg", b"bytes", "image/jpeg")}

    def test_4xx_is_permanent(self, monkeypatch):
        monkeypatch.setattr(
            httpx, "post",
            lambda *a, **k: httpx.Response(403, text="bad key"),
        )
        with pytest.raises(GundiError) as info:
            GundiClient("k").create_event({})
        assert info.value.is_permanent
        assert info.value.status == 403

    def test_5xx_is_not_permanent(self, monkeypatch):
        monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(502, text=""))
        with pytest.raises(GundiError) as info:
            GundiClient("k").create_event({})
        assert not info.value.is_permanent

    def test_network_error_is_not_permanent(self, monkeypatch):
        def boom(*a, **k):
            raise httpx.ConnectError("down")

        monkeypatch.setattr(httpx, "post", boom)
        with pytest.raises(GundiError) as info:
            GundiClient("k").create_event({})
        assert not info.value.is_permanent
        assert info.value.status is None
