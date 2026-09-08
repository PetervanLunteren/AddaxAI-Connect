"""
Sensing Clues (Cluey) via Central: observation payloads and the API client.

Connect treats Sensing Clues as a notification channel, like EarthRanger.
When an alert rule fires, one observation is posted into the project's
Cluey group with a thumbnail attached, and that is the end of it: nothing
is updated or deleted afterwards. The observation id is ours, so a queue
message delivered twice updates the same observation instead of making a
second one.

The payload builders are pure so the notification coordinator, the
delivery worker and the API test endpoint all produce the same shape and
tests can check it without a network.

Cluey API (test host https://central-test.sensingclues.org/v1/, production
host to follow):
    POST {base}/users/login                    {"identifier", "password"} -> {"token": JWT, "user": {...}}
    GET  {base}/projects                       the groups this account belongs to
    POST {base}/projects/{pid}/alerts          JSON observation -> the alert object, with "id"
    POST {base}/alerts/{id}/media/{filename}   raw JPEG body
Every call but login sends the token as the x-access-token header. The
token lasts a year; a 401 means log in again. In the API an observation
is called an alert (legacy naming); "type": "alert" is a separate
information type.

The account is per project: a Cluey login and a group id, both stored in
the project's integration row. The client adds the identity fields (pid,
user, userid) so the builders and the coordinator never touch
credentials, and it learns its own user id from the login, so nobody has
to look that number up.

Confirmed against central-test on 7 and 8 September 2026: a bad token is
a 401 and a wrong password too; the identity fields are required (401
without them); geometry is required and location is optional; a
client-supplied id creates on the first post and updates on the next, and
the update answers with the bare id as plain text; a timestamp with an
offset is stored as sent; appVersion, autoTimestamp, classifier and
timestampClassification may be absent; a wrong group id, or a group that
did not invite the account, is a 404 whose message names the account and
the group; the media call answers with the alert object; human_activity
is stored under their internal type "offence"; the count for the generic
species field is nAnimal, a string like their own number fields; the
login answers {"user": {"username": "<numeric account id>"}}; and the
group listing needs an appVersion header, ours is accepted, without one
it is a 401.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

import httpx

from .timestamps import isoformat_with_offset

# Values agreed with Sensing Clues (Jan Kees Schakel, September 2026).
APP_VERSION = "4.0.0-Addax"
SOURCE = "AddaxAI"
TAGS = ("Addax-AI",)
OBSERVATION_TYPE_ANIMAL = "animal_sighting"
OBSERVATION_TYPE_HUMAN = "human_activity"
OBSERVATION_TYPE_POI = "point_of_interest"
TYPE_DETECTION = "detection"
TYPE_ALERT = "alert"
# MegaDetector only says person or vehicle. Cluey wants a human activity
# and a transport; "Vehicle ns" is their value for an unspecified vehicle.
HUMAN_ACTIVITY = "Person in camera"
TRANSPORT = {"person": "On Foot", "vehicle": "Vehicle ns"}
TEST_CAMERA_ID = "addaxai-connect-test"

REQUEST_TIMEOUT_SECONDS = 30


class SensingCluesError(Exception):
    """A Cluey API call failed. status is None for network errors."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status

    @property
    def is_permanent(self) -> bool:
        """A 4xx means the payload, the group or the account is wrong; a
        retry cannot help."""
        return self.status is not None and 400 <= self.status < 500


# What a project's integration row holds for this kind. The password is
# stored like the Gundi API key and never leaves the server.
CONFIG_KEYS = ("base_url", "username", "password", "group_id")


def is_configured(config: Optional[Dict[str, Any]]) -> bool:
    """A project is set up when its row carries an account and a group."""
    config = config or {}
    return all(config.get(key) for key in CONFIG_KEYS)


def client_from_config(config: Optional[Dict[str, Any]]) -> "SensingCluesClient":
    """A client from the project's integration row. Raises ValueError on
    an incomplete row, which the caller reports as not set up."""
    config = config or {}
    return SensingCluesClient(
        config.get("base_url") or "",
        config.get("username") or "",
        config.get("password") or "",
    )


def new_observation_id() -> str:
    """Made once at queue time, so a redelivered message updates the same
    observation. Cluey accepts a client id on create."""
    return uuid.uuid4().hex


def _place(lat: Optional[float], lon: Optional[float], what: str) -> Dict[str, Any]:
    """The location of one observation as GeoJSON, lon before lat. Cluey
    requires geometry (400 without it) and ignores the string pair its
    example also carried. Raises ValueError without coordinates: an
    observation nobody can place on a map is noise, so the caller skips it
    and logs why.
    """
    if lat is None or lon is None:
        raise ValueError(f"{what} has no location")
    return {"geometry": {"type": "Point", "coordinates": [lon, lat]}}


def _observation(
    *,
    observation_id: str,
    observation_type: str,
    information_type: str,
    timestamp: str,
    description: str,
    lat: Optional[float],
    lon: Optional[float],
    what: str,
) -> Dict[str, Any]:
    """The fields every observation carries. Identity fields (pid, user,
    userid) are added by the client."""
    return {
        "id": observation_id,
        "appVersion": APP_VERSION,
        "observation_type": observation_type,
        "type": information_type,
        "timestamp": timestamp,
        "autoTimestamp": True,
        **_place(lat, lon, what),
        "tags": list(TAGS),
        "description": description,
        "source": SOURCE,
    }


def build_detection_observation(
    *,
    observation_id: str,
    device_id: str,
    species: str,
    species_display: str,
    captured_at: datetime,
    tz: ZoneInfo,
    lat: Optional[float],
    lon: Optional[float],
    site_name: Optional[str],
    image_url: str,
    classifier: str,
    count: Optional[int] = None,
    confidence: Optional[float] = None,
    scientific_name: Optional[str] = None,
) -> Dict[str, Any]:
    """One observation for one detection alert.

    An animal is an animal sighting with the generic species field, the
    common name as we show it plus the Latin name when we have one. Cluey
    matches on either; the class-specific fields (mammalSpecies and so on)
    are never used because we do not know the class of a label. A person
    or a vehicle is a human activity with a transport.
    """
    where = site_name or device_id
    ours: Dict[str, Any] = {"cameraId": device_id, "link": image_url}
    if site_name:
        ours["siteName"] = site_name
    if count is not None:
        ours["count"] = count
    if confidence is not None:
        ours["confidence"] = round(confidence, 2)

    if species in TRANSPORT:
        observation_type = OBSERVATION_TYPE_HUMAN
        values: Dict[str, Any] = {
            "humanActivity": HUMAN_ACTIVITY,
            "transport": TRANSPORT[species],
        }
    else:
        observation_type = OBSERVATION_TYPE_ANIMAL
        values = {"species": species_display}
        if scientific_name:
            values["latinName"] = scientific_name
        if count is not None:
            # Their count field for the generic species, a string like
            # their own number fields
            values["nAnimal"] = str(count)
    values["addaxAI"] = ours

    observation = _observation(
        observation_id=observation_id,
        observation_type=observation_type,
        information_type=TYPE_DETECTION,
        timestamp=isoformat_with_offset(captured_at, tz),
        description=f"{species_display} at {where}",
        lat=lat,
        lon=lon,
        what="detection",
    )
    observation["classifier"] = classifier
    observation["timestampClassification"] = isoformat_with_offset(datetime.now(timezone.utc))
    observation["values"] = values
    return observation


def build_camera_observation(
    *,
    observation_id: str,
    device_id: str,
    alert: str,
    summary: str,
    occurred_at: datetime,
    lat: Optional[float],
    lon: Optional[float],
    site_name: Optional[str],
    camera_url: str,
) -> Dict[str, Any]:
    """One point of interest alert for a camera condition or theft watch
    alert. alert is our trigger name (battery_low, camera_silent, ...),
    which Sensing Clues maps on their side; summary is the one-line text
    the email already uses and becomes the headline.
    """
    ours: Dict[str, Any] = {
        "alert": alert,
        "summary": summary,
        "cameraId": device_id,
        "link": camera_url,
    }
    if site_name:
        ours["siteName"] = site_name
    observation = _observation(
        observation_id=observation_id,
        observation_type=OBSERVATION_TYPE_POI,
        information_type=TYPE_ALERT,
        timestamp=isoformat_with_offset(occurred_at),
        description=summary,
        lat=lat,
        lon=lon,
        what="camera",
    )
    observation["values"] = {"addaxAI": ours}
    return observation


def build_test_observation(
    *, observation_id: str, project_name: str, lat: float, lon: float
) -> Dict[str, Any]:
    """The observation the integration page's test button sends. It is a
    real observation in the group, so it says so in the headline, and it
    is a point of interest so it never counts as a sighting."""
    observation = _observation(
        observation_id=observation_id,
        observation_type=OBSERVATION_TYPE_POI,
        information_type=TYPE_ALERT,
        timestamp=isoformat_with_offset(datetime.now(timezone.utc)),
        description=f"Test from AddaxAI Connect ({project_name})",
        lat=lat,
        lon=lon,
        what="test",
    )
    observation["values"] = {"addaxAI": {"alert": "test", "cameraId": TEST_CAMERA_ID}}
    return observation


def parse_alert_id(response: httpx.Response) -> str:
    """Cluey answers a create with the alert object as JSON and an update
    (the same id posted again) with the bare id as plain text; the id is
    what the media call needs. Anything else is a contract change worth
    crashing on."""
    try:
        body: Any = response.json()
    except ValueError:
        body = response.text.strip()
    if isinstance(body, str) and body:
        return body
    if isinstance(body, dict) and body.get("id"):
        return str(body["id"])
    raise SensingCluesError(f"Unexpected Sensing Clues response: {body!r}")


class SensingCluesClient:
    """Logs in lazily, keeps the token in memory, logs in once more on a
    401 and retries that one call. No other retry: the queue delivers a
    message again after a network error, and a 4xx is final.

    One client serves one project. The delivery worker builds a fresh one
    per message from the project's row, so a changed account takes effect
    on the next observation and no token is kept between messages.
    """

    def __init__(self, base_url: str, username: str, password: str):
        if not (base_url and username and password):
            raise ValueError("Sensing Clues credentials are incomplete")
        self._base_url = base_url.rstrip("/")
        self._username = username
        self._password = password
        self._token: Optional[str] = None
        self._user_id: Optional[str] = None

    def login(self) -> str:
        response = _http_request(
            "POST",
            f"{self._base_url}/users/login",
            headers={},
            json={"identifier": self._username, "password": self._password},
        )
        if response.status_code >= 400:
            raise SensingCluesError(
                f"Sensing Clues login failed with {response.status_code}: {response.text[:300]}",
                status=response.status_code,
            )
        body = response.json()
        token = body.get("token") if isinstance(body, dict) else None
        if not token:
            raise SensingCluesError(f"Unexpected Sensing Clues login response: {body!r}")
        # Their answer carries the account's numeric id under user.username,
        # despite the name. Every observation must send it as userid, so a
        # login without it is worth failing on rather than posting a 401.
        user_id = (body.get("user") or {}).get("username")
        if not user_id:
            raise SensingCluesError(f"Sensing Clues login returned no account id: {body!r}")
        self._token = token
        self._user_id = str(user_id)
        return token

    def list_groups(self) -> List[Dict[str, str]]:
        """The groups this account is a member of, id and name each. Cluey
        wants an appVersion header here and answers 401 without one."""
        response = self._request(
            "GET", f"{self._base_url}/projects", headers={"appVersion": APP_VERSION}
        )
        body = response.json()
        rows = body if isinstance(body, list) else [body]
        return [
            {"id": str(row["id"]), "name": row.get("name") or ""}
            for row in rows
            if isinstance(row, dict) and row.get("id")
        ]

    def verify(self, group_id: int) -> None:
        """Check that the account works and may post into the group. Used
        when the settings are saved, so a wrong password or an uninvited
        account is refused before it is stored. The message is written for
        the user, because the API hands it straight to them."""
        groups = self.list_groups()
        if any(group["id"] == str(group_id) for group in groups):
            return
        if not groups:
            raise SensingCluesError(
                f"The account {self._username} is not a member of any group yet. "
                f"Invite it into your group in Cluey or Central first."
            )
        known = ", ".join(f"{group['name']} ({group['id']})" for group in groups)
        raise SensingCluesError(
            f"The account {self._username} is not a member of group {group_id}. "
            f"It is a member of {known}."
        )

    def create_observation(self, group_id: int, observation: Dict[str, Any]) -> str:
        # Log in first: the account id comes from the login and the body
        # needs it, and a post without userid is refused with a 401.
        self._ensure_token()
        body = {
            **observation,
            "pid": str(group_id),
            "user": self._username,
            "userid": self._user_id,
        }
        response = self._request("POST", f"{self._base_url}/projects/{group_id}/alerts", json=body)
        return parse_alert_id(response)

    def attach_image(self, alert_id: str, filename: str, data: bytes) -> None:
        self._request(
            "POST",
            f"{self._base_url}/alerts/{alert_id}/media/{filename}",
            content=data,
            headers={"content-type": "image/jpeg"},
        )

    def _ensure_token(self) -> None:
        if self._token is None:
            self.login()

    def _request(
        self, method: str, url: str, headers: Optional[Dict[str, str]] = None, **kwargs: Any
    ) -> httpx.Response:
        self._ensure_token()
        response = self._send(method, url, headers, **kwargs)
        if response.status_code == 401:
            # The token expired or the password was rotated: one fresh
            # login, one retry. A second 401 is final and raised below.
            self.login()
            response = self._send(method, url, headers, **kwargs)
        if response.status_code >= 400:
            raise SensingCluesError(
                f"Sensing Clues returned {response.status_code}: {response.text[:300]}",
                status=response.status_code,
            )
        return response

    def _send(
        self, method: str, url: str, headers: Optional[Dict[str, str]], **kwargs: Any
    ) -> httpx.Response:
        return _http_request(
            method, url, headers={"x-access-token": self._token or "", **(headers or {})}, **kwargs
        )


def _http_request(method: str, url: str, headers: Dict[str, str], **kwargs: Any) -> httpx.Response:
    try:
        return httpx.request(method, url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs)
    except httpx.HTTPError as e:
        raise SensingCluesError(f"Sensing Clues request failed: {e}") from e
