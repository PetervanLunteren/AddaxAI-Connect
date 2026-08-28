"""
Project integrations. EarthRanger (via Gundi) is the first one.

One row per project and kind in project_integrations. The API key is
written once and never returned; the page only sees that a key is set,
its last characters, and what the delivery worker recorded about the
connection (health, last event, last error, count). The test endpoint
posts a real event to Gundi, because Gundi has no ping: it lands on the
ranger map with "Test from AddaxAI Connect" in the title.

Routes are mounted under /api/projects/{project_id}/integrations/earthranger
and are project admin only.
"""
import asyncio
from datetime import datetime, timezone
from typing import Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.earthranger import GundiClient, GundiError, build_test_event
from shared.models import Project, ProjectIntegration, User
from auth.permissions import require_project_admin_access


router = APIRouter(
    prefix="/api/projects/{project_id}/integrations/earthranger",
    tags=["integrations"],
)

KIND = "earthranger"


class EarthRangerStatus(BaseModel):
    is_configured: bool
    is_enabled: bool = False
    api_key_hint: Optional[str] = None  # last characters, to recognise the key
    health_status: Optional[str] = None  # healthy | error | None (never tried)
    last_health_check: Optional[datetime] = None
    last_sent_at: Optional[datetime] = None
    last_error: Optional[str] = None
    events_sent: int = 0


class EarthRangerConfigRequest(BaseModel):
    api_key: str


class TestEventResponse(BaseModel):
    object_id: str


def key_hint(api_key: Optional[str]) -> Optional[str]:
    """Enough of the key to tell two apart, never enough to use it."""
    if not api_key or len(api_key) < 8:
        return None
    return api_key[-4:]


def status_of(integration: Optional[ProjectIntegration]) -> EarthRangerStatus:
    if integration is None:
        return EarthRangerStatus(is_configured=False)
    config = integration.config or {}
    return EarthRangerStatus(
        is_configured=bool(config.get("api_key")),
        is_enabled=integration.is_enabled,
        api_key_hint=key_hint(config.get("api_key")),
        health_status=integration.health_status,
        last_health_check=integration.last_health_check,
        last_sent_at=integration.last_sent_at,
        last_error=integration.last_error,
        events_sent=integration.events_sent or 0,
    )


async def _load(db: AsyncSession, project_id: int) -> Optional[ProjectIntegration]:
    return (await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == KIND,
        )
    )).scalar_one_or_none()


async def _test_location(db: AsyncSession, project_id: int) -> Tuple[Optional[float], Optional[float]]:
    """Somewhere on the project's map for the test event: the project area's
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


@router.get("", response_model=EarthRangerStatus)
async def get_earthranger(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    return status_of(await _load(db, project_id))


@router.put("", response_model=EarthRangerStatus)
async def configure_earthranger(
    project_id: int,
    request: EarthRangerConfigRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Save the Gundi API key and enable the integration. A new key resets
    the recorded health, the next event or test tells whether it works."""
    api_key = request.api_key.strip()
    if len(api_key) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API key looks too short",
        )
    integration = await _load(db, project_id)
    if integration is None:
        integration = ProjectIntegration(project_id=project_id, kind=KIND, config={})
        db.add(integration)
    integration.config = {"api_key": api_key}
    integration.is_enabled = True
    integration.health_status = None
    integration.last_health_check = None
    integration.last_error = None
    await db.commit()
    await db.refresh(integration)
    return status_of(integration)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def remove_earthranger(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Forget the key. Rules that send to EarthRanger stay as they are and
    simply stop delivering until a key is saved again."""
    integration = await _load(db, project_id)
    if integration is not None:
        await db.delete(integration)
        await db.commit()


@router.post("/test", response_model=TestEventResponse)
async def send_test_event(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Post one real test event through Gundi and record the outcome as the
    connection's health. 400 with Gundi's reason when it fails."""
    integration = await _load(db, project_id)
    api_key = (integration.config or {}).get("api_key") if integration else None
    if not integration or not api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="EarthRanger is not set up for this project",
        )

    lat, lon = await _test_location(db, project_id)
    if lat is None or lon is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add a site or a project area first, the test event needs a location",
        )

    project = await db.get(Project, project_id)
    event = build_test_event(project_name=project.name, lat=lat, lon=lon)
    client = GundiClient(api_key)
    now = datetime.now(timezone.utc)
    try:
        # httpx sync client off the event loop, like the statistics fits
        object_id = await asyncio.to_thread(client.create_event, event)
    except GundiError as e:
        integration.health_status = "error"
        integration.last_health_check = now
        integration.last_error = str(e)[:1000]
        await db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    integration.health_status = "healthy"
    integration.last_health_check = now
    integration.last_error = None
    await db.commit()
    return TestEventResponse(object_id=object_id)
