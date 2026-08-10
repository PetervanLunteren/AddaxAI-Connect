"""
Camera maintenance event endpoints.

Project admins log maintenance visits per camera: a date, the actions
done (fixed vocabulary), who performed them, and an optional note. The
event log replaces the shared spreadsheets teams kept for this. Admin
only on every endpoint; the derived last maintenance date that other
users see travels on the camera list response, not through here.

Same-prefix second router file, the camera_reference_images pattern.
"""
from datetime import date, datetime
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, Camera, CameraMaintenanceEvent
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from routers.cameras import (
    BulkUpdateResponse,
    _load_bulk_cameras,
    _verify_admin_on_all_projects,
)

router = APIRouter(prefix="/api/cameras", tags=["camera-maintenance"])

VALID_ACTION_TYPES = {"battery_change", "sd_card_swap", "inspection", "repair", "other"}


def validate_maintenance_event(
    action_types: List[str],
    event_date: date,
    today: date,
) -> Optional[str]:
    """Validate maintenance fields, returning an error message or None.

    Pure so it is unit-testable without a database, the same contract as
    camera_alert_rules.validate_rule_fields. The performed-by user
    existence check needs the database and lives in the endpoints.
    """
    if not action_types:
        return "at least one action is required"
    if not all(isinstance(a, str) for a in action_types):
        return "action_types must be strings"
    if len(action_types) != len(set(action_types)):
        return "action_types must not repeat"
    invalid = set(action_types) - VALID_ACTION_TYPES
    if invalid:
        return f"unknown action types {', '.join(sorted(invalid))}"

    if event_date > today:
        return "event_date must not be in the future"

    return None


class LogMaintenanceRequest(BaseModel):
    """One maintenance visit"""
    event_date: date
    action_types: List[str]
    performed_by_user_id: Optional[int] = None
    note: Optional[str] = None


class BulkLogMaintenanceRequest(LogMaintenanceRequest):
    """The same visit logged on several cameras at once"""
    camera_ids: List[int]


class MaintenanceEventResponse(BaseModel):
    """One logged maintenance visit"""
    id: int
    camera_id: int
    event_date: str  # YYYY-MM-DD
    action_types: List[str]
    performed_by_user_id: Optional[int] = None
    performed_by_email: Optional[str] = None
    note: Optional[str] = None
    created_at: str


async def _server_today(db: AsyncSession) -> date:
    """Today under the server timezone, the reference for the future-date check."""
    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return datetime.now(tz).date()


async def _load_camera_for_admin(
    db: AsyncSession, camera_id: int, current_user: User
) -> Camera:
    """Load a camera and require project admin access, 404/403 otherwise."""
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID {camera_id} not found",
        )

    if camera.project_id is None or not await can_admin_project(current_user, camera.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    return camera


def _event_to_response(
    event: CameraMaintenanceEvent, performed_by_email: Optional[str]
) -> MaintenanceEventResponse:
    return MaintenanceEventResponse(
        id=event.id,
        camera_id=event.camera_id,
        event_date=event.event_date.isoformat(),
        action_types=event.action_types,
        performed_by_user_id=event.performed_by_user_id,
        performed_by_email=performed_by_email,
        note=event.note,
        created_at=event.created_at.isoformat(),
    )


async def _check_performed_by_exists(
    db: AsyncSession, performed_by_user_id: Optional[int]
) -> None:
    """400 when the performed-by user id does not exist."""
    if performed_by_user_id is None:
        return
    result = await db.execute(select(User.id).where(User.id == performed_by_user_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User with ID {performed_by_user_id} not found",
        )


@router.get(
    "/{camera_id}/maintenance-events",
    response_model=List[MaintenanceEventResponse],
)
async def list_maintenance_events(
    camera_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List a camera's maintenance events, newest first (project admin)."""
    await _load_camera_for_admin(db, camera_id, current_user)

    rows = await db.execute(
        select(CameraMaintenanceEvent, User.email)
        .outerjoin(User, User.id == CameraMaintenanceEvent.performed_by_user_id)
        .where(CameraMaintenanceEvent.camera_id == camera_id)
        .order_by(CameraMaintenanceEvent.event_date.desc(), CameraMaintenanceEvent.id.desc())
    )
    return [_event_to_response(event, email) for event, email in rows.all()]


@router.post(
    "/{camera_id}/maintenance-events",
    response_model=MaintenanceEventResponse,
    status_code=status.HTTP_201_CREATED,
)
async def log_maintenance_event(
    camera_id: int,
    request: LogMaintenanceRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Log one maintenance visit on a camera (project admin)."""
    await _load_camera_for_admin(db, camera_id, current_user)

    error = validate_maintenance_event(
        request.action_types, request.event_date, await _server_today(db)
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    await _check_performed_by_exists(db, request.performed_by_user_id)

    event = CameraMaintenanceEvent(
        camera_id=camera_id,
        event_date=request.event_date,
        action_types=request.action_types,
        performed_by_user_id=request.performed_by_user_id,
        note=request.note or None,
        created_by_user_id=current_user.id,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    performed_by_email = None
    if event.performed_by_user_id is not None:
        result = await db.execute(select(User.email).where(User.id == event.performed_by_user_id))
        performed_by_email = result.scalar_one_or_none()

    return _event_to_response(event, performed_by_email)


@router.delete(
    "/{camera_id}/maintenance-events/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_maintenance_event(
    camera_id: int,
    event_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Delete one maintenance event (project admin)."""
    await _load_camera_for_admin(db, camera_id, current_user)

    result = await db.execute(
        select(CameraMaintenanceEvent).where(
            CameraMaintenanceEvent.id == event_id,
            CameraMaintenanceEvent.camera_id == camera_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Maintenance event with ID {event_id} not found",
        )

    await db.delete(event)
    await db.commit()


@router.post("/bulk-log-maintenance", response_model=BulkUpdateResponse)
async def bulk_log_maintenance(
    request: BulkLogMaintenanceRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Log the same maintenance visit on every selected camera.

    One field trip usually services a whole line of cameras on one day.
    """
    cameras = await _load_bulk_cameras(db, request.camera_ids)
    await _verify_admin_on_all_projects(current_user, cameras, db)

    error = validate_maintenance_event(
        request.action_types, request.event_date, await _server_today(db)
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    await _check_performed_by_exists(db, request.performed_by_user_id)

    for camera in cameras:
        db.add(
            CameraMaintenanceEvent(
                camera_id=camera.id,
                event_date=request.event_date,
                action_types=request.action_types,
                performed_by_user_id=request.performed_by_user_id,
                note=request.note or None,
                created_by_user_id=current_user.id,
            )
        )
    await db.commit()
    return BulkUpdateResponse(updated_count=len(cameras))
