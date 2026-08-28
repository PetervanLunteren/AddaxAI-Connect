"""
EarthRanger via Gundi: event payloads and the Gundi client.

Connect treats EarthRanger as a notification channel. When an alert rule
fires, one Gundi event is posted with the annotated image attached, and
that is the end of it: events are never updated or deleted afterwards.
Gundi forwards the event to the EarthRanger site the project's Gundi
connection points at.

The payload builders are pure so the notification coordinator, the
delivery worker and the API test endpoint all produce the same shape and
tests can check it without a network.

Gundi Sensors API v2 (https://support.earthranger.com/developer_docs/gundi-api):
    POST {base}/events/                      -> {"object_id": ..., "created_at": ...}
    POST {base}/events/{object_id}/attachments/   multipart, one file per form field
Header on both: apikey. Timestamps must carry a timezone offset; a naive
timestamp is read as UTC on the Gundi side, which would shift every photo
by the site's offset, so the builders always localise first.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

import httpx

GUNDI_BASE_URL = "https://sensors.api.gundiservice.org/v2"

# EarthRanger event type slugs. They must exist on the destination site,
# with a schema whose keys match event_details below; the docs page carries
# the schema JSON. Agreed with EarthRanger on 2026-08-28: the keys carry an
# addaxai_ prefix (EarthRanger's convention, one namespace per source) and
# no product name, so the desktop AddaxAI can send the same event type and a
# site sets it up once for both.
EVENT_TYPE_DETECTION = "addaxai_detection"
EVENT_TYPE_CAMERA_ALERT = "addaxai_camera_alert"

# MegaDetector categories that are not species. Sent as event_details.category
# so a site can style or route people and vehicles differently.
NON_ANIMAL_CATEGORIES = {"person", "vehicle"}

REQUEST_TIMEOUT_SECONDS = 30


class GundiError(Exception):
    """A Gundi API call failed. status is None for network errors."""

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status

    @property
    def is_permanent(self) -> bool:
        """A 4xx means the payload or key is wrong; a retry cannot help."""
        return self.status is not None and 400 <= self.status < 500


def format_recorded_at(moment: datetime, tz: Optional[ZoneInfo] = None) -> str:
    """ISO 8601 with offset. A naive moment is a camera-clock reading and
    needs the server timezone; an aware one is passed through."""
    if moment.tzinfo is None:
        if tz is None:
            raise ValueError("naive datetime needs a timezone")
        moment = moment.replace(tzinfo=tz)
    return moment.isoformat(timespec="seconds")


def category_of(species: str) -> str:
    return species if species in NON_ANIMAL_CATEGORIES else "animal"


def build_detection_event(
    *,
    device_id: str,
    species: str,
    species_display: str,
    captured_at: datetime,
    tz: ZoneInfo,
    lat: Optional[float],
    lon: Optional[float],
    site_name: Optional[str],
    image_url: str,
    count: Optional[int] = None,
    confidence: Optional[float] = None,
    scientific_name: Optional[str] = None,
) -> Dict[str, Any]:
    """One Gundi event for one detection alert.

    Raises ValueError without coordinates: an event a ranger cannot place
    on the map is noise, so the caller skips it and logs why.
    """
    if lat is None or lon is None:
        raise ValueError("detection has no location")
    where = site_name or device_id
    details: Dict[str, Any] = {
        "addaxai_species": species_display,
        "addaxai_category": category_of(species),
        "addaxai_camera_id": device_id,
        "addaxai_link": image_url,
    }
    if scientific_name:
        details["addaxai_scientific_name"] = scientific_name
    if count is not None:
        details["addaxai_count"] = count
    if confidence is not None:
        details["addaxai_confidence"] = round(confidence, 2)
    if site_name:
        details["addaxai_site"] = site_name
    return {
        "source": device_id,
        "title": f"{species_display} at {where}",
        "event_type": EVENT_TYPE_DETECTION,
        "recorded_at": format_recorded_at(captured_at, tz),
        "location": {"lat": lat, "lon": lon},
        "event_details": details,
    }


def build_camera_event(
    *,
    device_id: str,
    alert: str,
    summary: str,
    occurred_at: datetime,
    lat: Optional[float],
    lon: Optional[float],
    site_name: Optional[str],
    camera_url: str,
) -> Dict[str, Any]:
    """One Gundi event for a camera condition or theft watch alert.

    alert is a short machine label (battery_low, camera_silent, ...),
    summary the one-line human text the email already uses.
    """
    if lat is None or lon is None:
        raise ValueError("camera has no location")
    where = site_name or device_id
    details: Dict[str, Any] = {
        "addaxai_alert": alert,
        "addaxai_summary": summary,
        "addaxai_camera_id": device_id,
        "addaxai_link": camera_url,
    }
    if site_name:
        details["addaxai_site"] = site_name
    return {
        "source": device_id,
        "title": f"Camera alert at {where}",
        "event_type": EVENT_TYPE_CAMERA_ALERT,
        "recorded_at": format_recorded_at(occurred_at),
        "location": {"lat": lat, "lon": lon},
        "event_details": details,
    }


def build_test_event(*, project_name: str, lat: float, lon: float) -> Dict[str, Any]:
    """The event the integration page's test button sends. It is a real
    event on the ranger map, so it says so in the title."""
    return {
        "source": "addaxai-connect-test",
        "title": f"Test from AddaxAI Connect ({project_name})",
        "event_type": EVENT_TYPE_DETECTION,
        "recorded_at": format_recorded_at(datetime.now(timezone.utc)),
        "location": {"lat": lat, "lon": lon},
        "event_details": {
            "addaxai_species": "Test",
            "addaxai_category": "animal",
            "addaxai_camera_id": "addaxai-connect-test",
            "addaxai_link": "",
        },
    }


def parse_object_id(body: Any) -> str:
    """Gundi answers with {"object_id": ...}, or a list of those when a
    list was posted. Anything else is a contract change worth crashing on."""
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict) and body.get("object_id"):
        return str(body["object_id"])
    raise GundiError(f"Unexpected Gundi response: {body!r}")


class GundiClient:
    """Two calls, no retries. The queue delivers a message again after a
    network error; a 4xx is final and is logged instead."""

    def __init__(self, api_key: str, base_url: str = GUNDI_BASE_URL):
        if not api_key:
            raise ValueError("Gundi API key is empty")
        self._headers = {"apikey": api_key}
        self._base_url = base_url.rstrip("/")

    def create_event(self, payload: Dict[str, Any]) -> str:
        response = self._post(f"{self._base_url}/events/", json=payload)
        return parse_object_id(response.json())

    def attach_file(self, object_id: str, filename: str, data: bytes) -> None:
        self._post(
            f"{self._base_url}/events/{object_id}/attachments/",
            files={"file1": (filename, data, "image/jpeg")},
        )

    def _post(self, url: str, **kwargs: Any) -> httpx.Response:
        try:
            response = httpx.post(
                url, headers=self._headers, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs
            )
        except httpx.HTTPError as e:
            raise GundiError(f"Gundi request failed: {e}") from e
        if response.status_code >= 400:
            raise GundiError(
                f"Gundi returned {response.status_code}: {response.text[:300]}",
                status=response.status_code,
            )
        return response
