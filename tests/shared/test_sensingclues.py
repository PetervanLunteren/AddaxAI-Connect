"""Tests for the Sensing Clues (Cluey) observation builders and client."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import httpx
import pytest

from shared.sensingclues import (
    APP_VERSION,
    OBSERVATION_TYPE_ANIMAL,
    OBSERVATION_TYPE_HUMAN,
    OBSERVATION_TYPE_POI,
    TYPE_ALERT,
    TYPE_DETECTION,
    SensingCluesClient,
    SensingCluesError,
    build_camera_observation,
    build_detection_observation,
    build_test_observation,
    client_from_config,
    is_configured,
    new_observation_id,
    parse_alert_id,
)

AMS = ZoneInfo("Europe/Amsterdam")
OBS_ID = "3f2a9c1e6d0b4d2f9a1b7c8d9e0f1a2b"
IDENTITY_KEYS = {"pid", "user", "userid"}


def _detection(**overrides):
    kwargs = dict(
        observation_id=OBS_ID,
        device_id="CAM-012",
        species="red fox",
        species_display="Red fox",
        captured_at=datetime(2026, 7, 1, 8, 30),
        tz=AMS,
        lat=52.1,
        lon=5.2,
        site_name="Site 4",
        image_url="https://connect.example.org/projects/1/images?image=abc",
        classifier="DeepFaune v1.4",
        count=2,
        confidence=0.87654,
        scientific_name="Vulpes vulpes",
    )
    kwargs.update(overrides)
    return build_detection_observation(**kwargs)


class TestBuildDetectionObservation:
    def test_animal_top_level(self):
        obs = _detection()
        assert obs["id"] == OBS_ID
        assert obs["appVersion"] == APP_VERSION
        assert obs["observation_type"] == OBSERVATION_TYPE_ANIMAL
        assert obs["type"] == TYPE_DETECTION
        assert obs["timestamp"] == "2026-07-01T08:30:00+02:00"
        assert obs["autoTimestamp"] is True
        assert obs["geometry"] == {"type": "Point", "coordinates": [5.2, 52.1]}
        assert "location" not in obs  # geometry is what Cluey requires, the string pair is not read
        assert obs["tags"] == ["Addax-AI"]
        assert obs["description"] == "Red fox at Site 4"
        assert obs["source"] == "AddaxAI"
        assert obs["classifier"] == "DeepFaune v1.4"

    def test_animal_values(self):
        assert _detection()["values"] == {
            "species": "Red fox",
            "latinName": "Vulpes vulpes",
            "nAnimal": "2",
            "addaxAI": {
                "cameraId": "CAM-012",
                "link": "https://connect.example.org/projects/1/images?image=abc",
                "siteName": "Site 4",
                "count": 2,
                "confidence": 0.88,
            },
        }

    def test_person_is_human_activity_on_foot(self):
        obs = _detection(species="person", species_display="Person", scientific_name=None)
        assert obs["observation_type"] == OBSERVATION_TYPE_HUMAN
        assert obs["description"] == "Person at Site 4"
        assert obs["values"]["humanActivity"] == "Person in camera"
        assert obs["values"]["transport"] == "On Foot"
        assert "species" not in obs["values"]
        assert "latinName" not in obs["values"]
        assert "nAnimal" not in obs["values"]

    def test_vehicle_is_unspecified_vehicle(self):
        obs = _detection(species="vehicle", species_display="Vehicle", scientific_name=None)
        assert obs["observation_type"] == OBSERVATION_TYPE_HUMAN
        assert obs["values"]["transport"] == "Vehicle ns"

    def test_optional_fields_omitted(self):
        obs = _detection(count=None, confidence=None, scientific_name=None, site_name=None)
        assert "latinName" not in obs["values"]
        assert "nAnimal" not in obs["values"]
        ours = obs["values"]["addaxAI"]
        assert "count" not in ours
        assert "confidence" not in ours
        assert "siteName" not in ours

    def test_no_site_uses_camera_in_description(self):
        assert _detection(site_name=None)["description"] == "Red fox at CAM-012"

    def test_missing_location_raises(self):
        with pytest.raises(ValueError):
            _detection(lat=None)
        with pytest.raises(ValueError):
            _detection(lon=None)

    def test_classification_timestamp_is_utc_now(self):
        assert _detection()["timestampClassification"].endswith("+00:00")

    def test_no_identity_fields(self):
        # pid, user and userid are the client's job, the builders never see credentials
        assert not IDENTITY_KEYS & set(_detection())


class TestBuildCameraObservation:
    def _camera(self, **overrides):
        kwargs = dict(
            observation_id=OBS_ID,
            device_id="CAM-012",
            alert="battery_low",
            summary="CAM-012 with battery below 20%: 12%",
            occurred_at=datetime(2026, 7, 1, 6, 0, tzinfo=timezone.utc),
            lat=52.1,
            lon=5.2,
            site_name="Site 4",
            camera_url="https://connect.example.org/projects/1/cameras",
        )
        kwargs.update(overrides)
        return build_camera_observation(**kwargs)

    def test_shape(self):
        obs = self._camera()
        assert obs["observation_type"] == OBSERVATION_TYPE_POI
        assert obs["type"] == TYPE_ALERT
        assert obs["timestamp"] == "2026-07-01T06:00:00+00:00"
        assert obs["description"] == "CAM-012 with battery below 20%: 12%"
        assert obs["values"] == {
            "addaxAI": {
                "alert": "battery_low",
                "summary": "CAM-012 with battery below 20%: 12%",
                "cameraId": "CAM-012",
                "link": "https://connect.example.org/projects/1/cameras",
                "siteName": "Site 4",
            }
        }
        # Nothing was classified, so no classifier keys
        assert "classifier" not in obs
        assert "timestampClassification" not in obs
        assert not IDENTITY_KEYS & set(obs)

    def test_missing_location_raises(self):
        with pytest.raises(ValueError):
            self._camera(lat=None, lon=None)


class TestBuildTestObservation:
    def test_says_test_and_is_a_point_of_interest(self):
        obs = build_test_observation(observation_id=OBS_ID, project_name="Demo", lat=1.0, lon=2.0)
        assert obs["description"] == "Test from AddaxAI Connect (Demo)"
        assert obs["observation_type"] == OBSERVATION_TYPE_POI
        assert obs["type"] == TYPE_ALERT
        assert obs["geometry"]["coordinates"] == [2.0, 1.0]
        assert obs["timestamp"].endswith("+00:00")
        assert obs["values"] == {"addaxAI": {"alert": "test", "cameraId": "addaxai-connect-test"}}


class TestParseAlertId:
    def test_create_answers_with_the_object(self):
        response = httpx.Response(200, json={"id": "n12b8e8d9c64912ea", "pid": "1"})
        assert parse_alert_id(response) == "n12b8e8d9c64912ea"

    def test_update_answers_with_the_bare_id_as_text(self):
        # Seen on central-test: the second post of the same id returns the
        # id without quotes, which is not JSON
        response = httpx.Response(200, text="240c79c2c1374e3ea49de1d2ca670aef")
        assert parse_alert_id(response) == "240c79c2c1374e3ea49de1d2ca670aef"

    def test_missing_raises(self):
        for response in (
            httpx.Response(200, json={"ok": True}),
            httpx.Response(200, json=[]),
            httpx.Response(200, text=""),
        ):
            with pytest.raises(SensingCluesError):
                parse_alert_id(response)


def _config(**overrides):
    values = dict(
        base_url="https://central-test.sensingclues.org/v1/",
        username="addax_service",
        password="fake-test-password",
        group_id=3523928,
    )
    values.update(overrides)
    return values


class TestConfig:
    def test_all_four_values_required(self):
        assert is_configured(_config())
        for key in ("base_url", "username", "password", "group_id"):
            assert not is_configured(_config(**{key: None}))

    def test_missing_row_is_not_configured(self):
        assert not is_configured(None)
        assert not is_configured({})

    def test_client_from_config(self):
        assert isinstance(client_from_config(_config()), SensingCluesClient)

    def test_client_from_an_incomplete_row_raises(self):
        for key in ("base_url", "username", "password"):
            with pytest.raises(ValueError):
                client_from_config(_config(**{key: ""}))
        with pytest.raises(ValueError):
            client_from_config(None)

    def test_the_group_id_is_not_needed_to_build_a_client(self):
        # The group is an argument of every call, not part of the account
        assert isinstance(client_from_config(_config(group_id=None)), SensingCluesClient)


def test_new_observation_id_is_32_hex():
    value = new_observation_id()
    assert len(value) == 32
    int(value, 16)
    assert value != new_observation_id()


class FakeHttp:
    """A scripted httpx.request: one response per call, in order, and a
    record of every call made."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, method, url, headers=None, timeout=None, **kwargs):
        self.calls.append({"method": method, "url": url, "headers": headers, **kwargs})
        return self.responses.pop(0)


def _client():
    return SensingCluesClient("https://cluey.test/v1/", "addax_service", "fake-test-password")


# Their login answers with the account's numeric id under user.username
LOGIN_OK = lambda token="tok-1": httpx.Response(  # noqa: E731
    200, json={"token": token, "user": {"username": "999"}}
)
ALERT_OK = lambda: httpx.Response(200, json={"id": "n12b8e8d9c64912ea", "pid": "3523928"})  # noqa: E731
GROUPS_OK = lambda: httpx.Response(  # noqa: E731
    200, json=[{"id": "3523928", "name": "Addax_testgroup"}, {"id": "77", "name": "Other"}]
)


class TestClient:
    def test_incomplete_credentials_rejected(self):
        with pytest.raises(ValueError):
            SensingCluesClient("https://cluey.test/v1/", "", "pw")

    def test_login_posts_identifier_and_password_and_caches_token(self, monkeypatch):
        http = FakeHttp(LOGIN_OK())
        monkeypatch.setattr(httpx, "request", http)
        client = _client()
        assert client.login() == "tok-1"
        assert http.calls[0]["method"] == "POST"
        assert http.calls[0]["url"] == "https://cluey.test/v1/users/login"
        assert http.calls[0]["json"] == {"identifier": "addax_service", "password": "fake-test-password"}
        assert "x-access-token" not in http.calls[0]["headers"]

    def test_create_observation_adds_identity_and_token(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), ALERT_OK())
        monkeypatch.setattr(httpx, "request", http)
        alert_id = _client().create_observation(3523928, {"description": "x"})
        assert alert_id == "n12b8e8d9c64912ea"
        call = http.calls[1]
        assert call["url"] == "https://cluey.test/v1/projects/3523928/alerts"
        assert call["headers"]["x-access-token"] == "tok-1"
        # userid comes from the login, nothing stored and nothing typed
        assert call["json"] == {
            "description": "x", "pid": "3523928", "user": "addax_service", "userid": "999",
        }

    def test_lazy_login_happens_once_across_calls(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), ALERT_OK(), ALERT_OK())
        monkeypatch.setattr(httpx, "request", http)
        client = _client()
        client.create_observation(1, {})
        client.create_observation(1, {})
        logins = [c for c in http.calls if c["url"].endswith("/users/login")]
        assert len(logins) == 1

    def test_401_logs_in_again_and_retries_once(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), httpx.Response(401, text="expired"), LOGIN_OK("tok-2"), ALERT_OK())
        monkeypatch.setattr(httpx, "request", http)
        assert _client().create_observation(1, {}) == "n12b8e8d9c64912ea"
        assert [c["url"].rsplit("/", 1)[-1] for c in http.calls] == ["login", "alerts", "login", "alerts"]
        assert http.calls[3]["headers"]["x-access-token"] == "tok-2"

    def test_second_401_is_raised_as_permanent(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), httpx.Response(401), LOGIN_OK(), httpx.Response(401, text="still"))
        monkeypatch.setattr(httpx, "request", http)
        with pytest.raises(SensingCluesError) as info:
            _client().create_observation(1, {})
        assert info.value.status == 401
        assert info.value.is_permanent
        assert len(http.calls) == 4

    def test_attach_image_posts_raw_bytes_with_jpeg_content_type(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), httpx.Response(201, json={"id": "n1"}))
        monkeypatch.setattr(httpx, "request", http)
        _client().attach_image("n1", "img-1.jpg", b"jpegbytes")
        call = http.calls[1]
        assert call["url"] == "https://cluey.test/v1/alerts/n1/media/img-1.jpg"
        assert call["content"] == b"jpegbytes"
        assert call["headers"]["content-type"] == "image/jpeg"
        assert call["headers"]["x-access-token"] == "tok-1"

    def test_login_failure_raises(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(httpx.Response(401, text="Unauthenticated")))
        with pytest.raises(SensingCluesError) as info:
            _client().create_observation(1, {})
        assert info.value.status == 401

    def test_login_without_token_raises(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(httpx.Response(200, json={"user": {}})))
        with pytest.raises(SensingCluesError):
            _client().login()

    def test_login_without_account_id_raises(self, monkeypatch):
        # Without it every observation would be refused with a 401, so it
        # is better to fail here than to post something that cannot land
        monkeypatch.setattr(httpx, "request", FakeHttp(httpx.Response(200, json={"token": "t"})))
        with pytest.raises(SensingCluesError) as info:
            _client().login()
        assert "account id" in str(info.value)

    def test_4xx_is_permanent_5xx_is_not(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(LOGIN_OK(), httpx.Response(404, text="no group")))
        with pytest.raises(SensingCluesError) as info:
            _client().create_observation(1, {})
        assert info.value.is_permanent and info.value.status == 404

        monkeypatch.setattr(httpx, "request", FakeHttp(LOGIN_OK(), httpx.Response(502, text="")))
        with pytest.raises(SensingCluesError) as info:
            _client().create_observation(1, {})
        assert not info.value.is_permanent

    def test_network_error_is_not_permanent(self, monkeypatch):
        def boom(*a, **k):
            raise httpx.ConnectError("down")

        monkeypatch.setattr(httpx, "request", boom)
        with pytest.raises(SensingCluesError) as info:
            _client().create_observation(1, {})
        assert not info.value.is_permanent
        assert info.value.status is None


class TestListGroups:
    def test_gets_the_groups_with_the_app_version_header(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), GROUPS_OK())
        monkeypatch.setattr(httpx, "request", http)
        groups = _client().list_groups()
        call = http.calls[1]
        assert call["method"] == "GET"
        assert call["url"] == "https://cluey.test/v1/projects"
        # Cluey answers 401 without this header
        assert call["headers"]["appVersion"] == APP_VERSION
        assert groups == [
            {"id": "3523928", "name": "Addax_testgroup"},
            {"id": "77", "name": "Other"},
        ]

    def test_rows_without_an_id_are_ignored(self, monkeypatch):
        http = FakeHttp(LOGIN_OK(), httpx.Response(200, json=[{"name": "nameless"}, {"id": 5}]))
        monkeypatch.setattr(httpx, "request", http)
        assert _client().list_groups() == [{"id": "5", "name": ""}]


class TestVerify:
    def test_passes_when_the_account_is_a_member(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(LOGIN_OK(), GROUPS_OK()))
        assert _client().verify(3523928) is None

    def test_names_the_groups_the_account_does_belong_to(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(LOGIN_OK(), GROUPS_OK()))
        with pytest.raises(SensingCluesError) as info:
            _client().verify(1)
        message = str(info.value)
        assert "not a member of group 1" in message
        assert "Addax_testgroup (3523928)" in message
        assert "Other (77)" in message

    def test_says_so_when_the_account_has_no_groups(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(LOGIN_OK(), httpx.Response(200, json=[])))
        with pytest.raises(SensingCluesError) as info:
            _client().verify(3523928)
        assert "not a member of any group" in str(info.value)

    def test_a_wrong_password_surfaces_as_the_login_error(self, monkeypatch):
        monkeypatch.setattr(httpx, "request", FakeHttp(httpx.Response(401, text="Unauthenticated")))
        with pytest.raises(SensingCluesError) as info:
            _client().verify(3523928)
        assert info.value.status == 401
