"""
Project integrations: EarthRanger (via Gundi) and Sensing Clues (via Central).

One row per project and kind in project_integrations. The status, get
and delete endpoints are the same for every kind; configure and test are
per kind because what is stored and what a test does differ:

- EarthRanger stores the project's Gundi API key. The key is never
  returned; the page sees that a key is set, its last characters, and what
  the delivery worker recorded about the connection. The test posts a
  real event, because Gundi has no ping.
- Sensing Clues stores only the Cluey group id. The account that posts is
  a server-level service account (SENSINGCLUES_* in the environment), so
  the status also says whether this server offers the integration at all.
  The test posts a real observation into the group.

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

from shared.config import get_settings
from shared.database import get_async_session
from shared.earthranger import GundiClient, GundiError, build_test_event
from shared.models import Project, ProjectIntegration, User
from shared.project_channels import EARTHRANGER, PROJECT_CHANNELS, SENSINGCLUES
from shared.sensingclues import (
    SensingCluesError,
    build_test_observation,
    client_from_settings,
    is_available,
    new_observation_id,
)
from auth.permissions import require_project_admin_access


router = APIRouter(
    prefix="/api/projects/{project_id}/integrations",
    tags=["integrations"],
)

SENSINGCLUES_NOT_ON_SERVER = "Sensing Clues is not enabled on this server"


class IntegrationStatus(BaseModel):
    """What the integration page shows. One model for every kind; the two
    vendor fields are simply null for the other kind."""
    is_available: bool = True  # false when this server does not offer the kind (Sensing Clues without an account)
    is_configured: bool
    is_enabled: bool = False
    api_key_hint: Optional[str] = None  # earthranger: last characters, to recognise the key
    group_id: Optional[int] = None  # sensingclues: the Cluey group
    health_status: Optional[str] = None  # healthy | error | None (never tried)
    last_health_check: Optional[datetime] = None
    last_sent_at: Optional[datetime] = None
    last_error: Optional[str] = None
    events_sent: int = 0


class EarthRangerConfigRequest(BaseModel):
    api_key: str


class SensingCluesConfigRequest(BaseModel):
    group_id: int


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
        is_available=is_available(get_settings()),
        is_configured=config.get("group_id") is not None,
        group_id=config.get("group_id"),
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

def validate_group_id(group_id: int) -> None:
    """An explicit 400 with a readable detail, like the API key checks,
    rather than a pydantic 422 the page cannot show."""
    if group_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The group id is a positive whole number",
        )


def require_sensingclues_available() -> None:
    """400 on a server without the service account. The page shows the
    same state from is_available in the status."""
    if not is_available(get_settings()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=SENSINGCLUES_NOT_ON_SERVER)


@router.put("/sensingclues", response_model=IntegrationStatus)
async def configure_sensingclues(
    project_id: int,
    request: SensingCluesConfigRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Save the Cluey group id (the group that invited addax_service) and
    enable the integration."""
    require_sensingclues_available()
    validate_group_id(request.group_id)
    integration = await save_config(db, SENSINGCLUES, project_id, {"group_id": request.group_id})
    return status_of(SENSINGCLUES, integration)


@router.post("/sensingclues/test", response_model=TestObservationResponse)
async def send_test_observation(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Post one real test observation into the group and record the outcome
    as the connection's health. 400 with Cluey's reason when it fails: a
    403 or 404 from Cluey means addax_service is not in the group or the
    group id is wrong."""
    require_sensingclues_available()
    integration = await load_integration(db, SENSINGCLUES, project_id)
    group_id = (integration.config or {}).get("group_id") if integration else None
    if not integration or not group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sensing Clues is not set up for this project",
        )
    lat, lon = await require_test_location(db, project_id, "observation")
    project = await db.get(Project, project_id)
    observation = build_test_observation(
        observation_id=new_observation_id(), project_name=project.name, lat=lat, lon=lon,
    )
    # A fresh client per test: one login per click, no token kept in the API
    client = client_from_settings(get_settings())
    try:
        alert_id = await asyncio.to_thread(client.create_observation, group_id, observation)
    except SensingCluesError as e:
        await record_health(db, integration, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    await record_health(db, integration, None)
    return TestObservationResponse(alert_id=alert_id)
