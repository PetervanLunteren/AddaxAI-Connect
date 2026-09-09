"""
Project integrations: EarthRanger (via Gundi) and Sensing Clues (via Central).

One row per project and kind in project_integrations. The status, get
and delete endpoints are the same for every kind; configure and test are
per kind because what is stored and what a test does differ:

- EarthRanger stores the project's Gundi API key. The key is never
  returned; the page sees that a key is set, its last characters, and what
  the delivery worker recorded about the connection. The test posts a
  real event, because Gundi has no ping.
- Sensing Clues stores a Cluey account (address, username, password) and
  the group id it posts into. The password is never returned; the page
  sees the address, the username and the group. Saving signs in first, so
  a wrong account is refused rather than stored. The group is picked from
  a list: once the account fields are filled the page asks the groups
  endpoint below, which signs in and reads the groups that account
  belongs to, so nobody types a group number. That read leaves the
  account refused for about a second, which is why it happens while a
  person fills in a form and never on the delivery path; the note in
  shared/sensingclues.py has the measurements.

Routes are mounted under /api/projects/{project_id}/integrations/{kind}
and are project admin only.
"""
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.earthranger import GundiClient, GundiError, build_test_event
from shared.models import Project, ProjectIntegration, User
from shared.project_channels import EARTHRANGER, PROJECT_CHANNELS, SENSINGCLUES
from shared.sensingclues import (
    SensingCluesError,
    address_problem,
    build_test_observation,
    client_from_config,
    is_configured,
    new_observation_id,
)
from auth.permissions import require_project_admin_access


router = APIRouter(
    prefix="/api/projects/{project_id}/integrations",
    tags=["integrations"],
)


class IntegrationStatus(BaseModel):
    """What the integration page shows. One model for every kind; a
    vendor's own fields are simply null for the other kind. No credential
    is ever in here."""
    is_configured: bool
    is_enabled: bool = False
    api_key_hint: Optional[str] = None  # earthranger: last characters, to recognise the key
    group_id: Optional[int] = None  # sensingclues: the Cluey group
    group_name: Optional[str] = None  # sensingclues: that group's name, as Cluey gave it
    username: Optional[str] = None  # sensingclues: the account that posts
    base_url: Optional[str] = None  # sensingclues: which Cluey environment
    health_status: Optional[str] = None  # healthy | error | None (never tried)
    last_health_check: Optional[datetime] = None
    last_sent_at: Optional[datetime] = None
    last_error: Optional[str] = None
    events_sent: int = 0


class EarthRangerConfigRequest(BaseModel):
    api_key: str


class SensingCluesConfigRequest(BaseModel):
    base_url: str
    username: str
    password: str
    group_id: int
    # Cluey's own name for the group, carried along from the list the page
    # showed so the settings page can name the group instead of numbering
    # it. Optional: a save made without the page still works.
    group_name: Optional[str] = None


class SensingCluesAccountRequest(BaseModel):
    """The account fields alone, before anything is saved. The groups
    endpoint takes these to sign in and read what that account can post
    into."""
    base_url: str
    username: str
    password: str


class SensingCluesGroup(BaseModel):
    id: int
    name: str


class SensingCluesGroupsResponse(BaseModel):
    groups: list[SensingCluesGroup]


class TestEventResponse(BaseModel):
    object_id: str


class TestObservationResponse(BaseModel):
    alert_id: str


# ---- shared by every kind ----

def known_kind(kind: str) -> str:
    """404 on a kind we do not have, like any other missing resource."""
    if kind not in PROJECT_CHANNELS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown integration")
    return kind


def key_hint(api_key: Optional[str]) -> Optional[str]:
    """Enough of the key to tell two apart, never enough to use it."""
    if not api_key or len(api_key) < 8:
        return None
    return api_key[-4:]


def status_of(kind: str, integration: Optional[ProjectIntegration]) -> IntegrationStatus:
    config: Dict[str, Any] = (integration.config or {}) if integration is not None else {}
    recorded: Dict[str, Any] = {}
    if integration is not None:
        recorded = dict(
            is_enabled=integration.is_enabled,
            health_status=integration.health_status,
            last_health_check=integration.last_health_check,
            last_sent_at=integration.last_sent_at,
            last_error=integration.last_error,
            events_sent=integration.events_sent or 0,
        )
    if kind == EARTHRANGER:
        return IntegrationStatus(
            is_configured=bool(config.get("api_key")),
            api_key_hint=key_hint(config.get("api_key")),
            **recorded,
        )
    return IntegrationStatus(
        is_configured=is_configured(config),
        group_id=config.get("group_id"),
        group_name=config.get("group_name"),
        username=config.get("username"),
        base_url=config.get("base_url"),
        **recorded,
    )


async def load_integration(db: AsyncSession, kind: str, project_id: int) -> Optional[ProjectIntegration]:
    return (await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == kind,
        )
    )).scalar_one_or_none()


async def save_config(
    db: AsyncSession, kind: str, project_id: int, config: Dict[str, Any]
) -> ProjectIntegration:
    """Upsert the row, enable it, and reset the recorded health: the next
    event or test tells whether the new setting works."""
    integration = await load_integration(db, kind, project_id)
    if integration is None:
        integration = ProjectIntegration(project_id=project_id, kind=kind, config={})
        db.add(integration)
    integration.config = config
    integration.is_enabled = True
    integration.health_status = None
    integration.last_health_check = None
    integration.last_error = None
    await db.commit()
    await db.refresh(integration)
    return integration


async def record_health(db: AsyncSession, integration: ProjectIntegration, error: Optional[str]) -> None:
    """Stamp a test's outcome on the row. error None means healthy."""
    integration.health_status = "error" if error else "healthy"
    integration.last_health_check = datetime.now(timezone.utc)
    integration.last_error = error[:1000] if error else None
    await db.commit()


async def test_location(db: AsyncSession, project_id: int) -> Tuple[Optional[float], Optional[float]]:
    """Somewhere on the project's map for a test: the project area's
    centre, else the first site. (None, None) when the project has neither."""
    row = (await db.execute(
        text("""
            SELECT ST_Y(ST_Centroid(location::geometry)) AS lat,
                   ST_X(ST_Centroid(location::geometry)) AS lon
            FROM projects WHERE id = :project_id AND location IS NOT NULL
        """),
        {"project_id": project_id},
    )).first()
    if row is None:
        row = (await db.execute(
            text("""
                SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
                FROM sites WHERE project_id = :project_id ORDER BY id LIMIT 1
            """),
            {"project_id": project_id},
        )).first()
    if row is None:
        return None, None
    return row.lat, row.lon


async def require_test_location(db: AsyncSession, project_id: int, what: str) -> Tuple[float, float]:
    lat, lon = await test_location(db, project_id)
    if lat is None or lon is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Add a site or a project area first, the test {what} needs a location",
        )
    return lat, lon


@router.get("/{kind}", response_model=IntegrationStatus)
async def get_integration(
    project_id: int,
    kind: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    known_kind(kind)
    return status_of(kind, await load_integration(db, kind, project_id))


@router.delete("/{kind}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_integration(
    project_id: int,
    kind: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Forget the setting. Rules on the channel stay as they are and simply
    stop delivering until it is saved again."""
    known_kind(kind)
    integration = await load_integration(db, kind, project_id)
    if integration is not None:
        await db.delete(integration)
        await db.commit()


# ---- EarthRanger ----

@router.put("/earthranger", response_model=IntegrationStatus)
async def configure_earthranger(
    project_id: int,
    request: EarthRangerConfigRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Save the Gundi API key and enable the integration."""
    api_key = request.api_key.strip()
    if len(api_key) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API key looks too short",
        )
    # A paste that grabbed surrounding text fails only at the first send,
    # with Gundi's cryptic "anonymous is not a valid UUID". Catch it here.
    if any(ch.isspace() for ch in api_key):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API key contains spaces, copy it with the copy button in the Gundi portal",
        )
    integration = await save_config(db, EARTHRANGER, project_id, {"api_key": api_key})
    return status_of(EARTHRANGER, integration)


@router.post("/earthranger/test", response_model=TestEventResponse)
async def send_test_event(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Post one real test event through Gundi and record the outcome as the
    connection's health. 400 with Gundi's reason when it fails."""
    integration = await load_integration(db, EARTHRANGER, project_id)
    api_key = (integration.config or {}).get("api_key") if integration else None
    if not integration or not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="EarthRanger is not set up for this project",
        )
    lat, lon = await require_test_location(db, project_id, "event")
    project = await db.get(Project, project_id)
    event = build_test_event(project_name=project.name, lat=lat, lon=lon)
    client = GundiClient(api_key)
    try:
        # httpx sync client off the event loop, like the statistics fits
        object_id = await asyncio.to_thread(client.create_event, event)
    except GundiError as e:
        await record_health(db, integration, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await record_health(db, integration, None)
    return TestEventResponse(object_id=object_id)


# ---- Sensing Clues ----

SENSINGCLUES_NOT_SET_UP = "Sensing Clues is not set up for this project"


def validate_group_id(group_id: int) -> None:
    """An explicit 400 with a readable detail, like the API key checks,
    rather than a pydantic 422 the page cannot show."""
    if group_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The group id is a positive whole number",
        )


def user_detail(error: SensingCluesError) -> str:
    """What the page shows for a failed call. Cluey answers the cases a
    user can actually fix with a bare status and its own wording, which
    tells them nothing, so those get a sentence. Anything else keeps its
    own message, shortened, because a wrong address can answer with a
    whole web page."""
    if error.status == 401:
        return "Could not sign in to Sensing Clues. Check the address, the username and the password."
    if error.status == 404:
        return ("Sensing Clues refused the group. Check that the group id is right and that the "
                "account is a member of it.")
    if error.status is not None:
        return (f"Sensing Clues answered {error.status}. Check that the address points at Sensing "
                "Clues and try again.")
    return str(error)


def account_from_request(base_url: str, username: str, password: str) -> Dict[str, Any]:
    """The three account fields as the client wants them. The password is
    stored and sent as typed: trimming it would silently break a password
    that really ends in a space."""
    return {
        "base_url": base_url.strip(),
        "username": username.strip(),
        "password": password,
    }


def client_or_400(config: Dict[str, Any]):
    try:
        return client_from_config(config)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Fill in the address, the username and the password",
        )


async def check_address_or_400(base_url: str) -> None:
    """Refuse an address the server should not fetch, before it fetches
    it. Off the event loop because the check resolves DNS."""
    problem = await asyncio.to_thread(address_problem, base_url)
    if problem:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)


@router.post("/sensingclues/groups", response_model=SensingCluesGroupsResponse)
async def list_sensingclues_groups(
    project_id: int,
    request: SensingCluesAccountRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """The groups an account can post into, for the setup screen's
    dropdown.

    Nothing is stored: the page calls this while someone is still filling
    the form, so the account arrives in the body rather than from a saved
    row. Signing in proves the account and the list proves the
    membership, which together is everything a save needs to be sure of.

    A project admin can read the groups of any account whose password
    they know, which is the account they are about to connect anyway.
    """
    await check_address_or_400(request.base_url)
    config = account_from_request(request.base_url, request.username, request.password)
    client = client_or_400(config)
    try:
        # httpx sync client off the event loop, like the statistics fits
        groups = await asyncio.to_thread(client.list_groups)
    except SensingCluesError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=user_detail(e))
    return SensingCluesGroupsResponse(
        groups=[
            SensingCluesGroup(id=int(g["id"]), name=g["name"])
            for g in groups
            if g["id"].isdigit()
        ]
    )


@router.put("/sensingclues", response_model=IntegrationStatus)
async def configure_sensingclues(
    project_id: int,
    request: SensingCluesConfigRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Save the Cluey account and the group it posts into.

    The account is checked before anything is stored, by signing in with
    it. The group is not checked again here. The page picked it from the
    list this account answered a moment ago, so the membership is already
    proven, and reading the list once more would leave the account
    refused for the next second, exactly when someone presses the test
    button. A save made outside the page, with a group the account cannot
    reach, is caught by the test observation instead.
    """
    validate_group_id(request.group_id)
    await check_address_or_400(request.base_url)
    config = {
        **account_from_request(request.base_url, request.username, request.password),
        "group_id": request.group_id,
    }
    if request.group_name:
        config["group_name"] = request.group_name.strip()
    client = client_or_400(config)
    try:
        # httpx sync client off the event loop, like the statistics fits.
        # ensure_token, not login: a save lands right after the page read
        # the group list, which leaves the account refused for a moment.
        await asyncio.to_thread(client.ensure_token)
    except SensingCluesError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=user_detail(e))

    integration = await save_config(db, SENSINGCLUES, project_id, config)
    return status_of(SENSINGCLUES, integration)


@router.post("/sensingclues/test", response_model=TestObservationResponse)
async def send_test_observation(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Post one real test observation into the group and record the
    outcome as the connection's health. 400 with Cluey's reason when it
    fails."""
    integration = await load_integration(db, SENSINGCLUES, project_id)
    config = (integration.config or {}) if integration else {}
    if not integration or not is_configured(config):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=SENSINGCLUES_NOT_SET_UP,
        )
    lat, lon = await require_test_location(db, project_id, "observation")
    project = await db.get(Project, project_id)
    observation = build_test_observation(
        observation_id=new_observation_id(), project_name=project.name, lat=lat, lon=lon,
    )
    # A fresh client per test: one login per click, no token kept in the API
    client = client_from_config(config)
    try:
        alert_id = await asyncio.to_thread(
            client.create_observation, config["group_id"], observation
        )
    except SensingCluesError as e:
        await record_health(db, integration, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=user_detail(e))
    await record_health(db, integration, None)
    return TestObservationResponse(alert_id=alert_id)
