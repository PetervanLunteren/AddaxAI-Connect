"""
Camera condition alert rules.

Any project member creates private rules for camera conditions, battery
below a threshold, SD card above a threshold, or a camera silent for a
number of days. The daily cron at 07:00 UTC evaluates active rules and
notifies the creator by email and/or Telegram, once per incident. Rules
are private, the creator is the only recipient and other members never
see them.

Routes are mounted under /api/projects/{project_id}/alert-rules. Every
endpoint requires project access on the target project; ownership is
enforced with 404 (not 403) so rules of other members are not
enumerable, same convention as reminders.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from shared.models import Camera, CameraAlertRule, Project, User
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_access_project


router = APIRouter(prefix="/api/projects", tags=["camera-alert-rules"])

VALID_RULE_TYPES = {"battery_low", "sd_full", "camera_silent"}
VALID_CHANNELS = {"email", "telegram"}


def validate_rule_fields(
    rule_type: str,
    threshold: int,
    channels: List[str],
    camera_ids: Optional[List[int]],
) -> Optional[str]:
    """Validate rule fields, returning an error message or None.

    Pure so it is unit-testable without a database. The camera-ids
    project-membership check needs the database and lives in the
    endpoints.
    """
    if rule_type not in VALID_RULE_TYPES:
        return f"rule_type must be one of {', '.join(sorted(VALID_RULE_TYPES))}"

    if rule_type == "camera_silent":
        if not (1 <= threshold <= 365):
            return "threshold must be between 1 and 365 days"
    else:
        if not (1 <= threshold <= 99):
            return "threshold must be between 1 and 99 percent"

    if not channels:
        return "at least one channel is required"
    if len(channels) != len(set(channels)):
        return "channels must not repeat"
    invalid = set(channels) - VALID_CHANNELS
    if invalid:
        return f"unknown channels {', '.join(sorted(invalid))}"

    if camera_ids is not None:
        # An empty list is rejected so "all cameras" has exactly one
        # representation, null
        if not camera_ids:
            return "camera_ids must be null for all cameras, or a non-empty list"
        if len(camera_ids) != len(set(camera_ids)):
            return "camera_ids must not repeat"
        if not all(isinstance(c, int) for c in camera_ids):
            return "camera_ids must be integers"

    return None


class AlertRuleResponse(BaseModel):
    id: int
    rule_type: str
    threshold: int
    camera_ids: Optional[List[int]] = None
    channels: List[str]
    is_active: bool
    # Read-only view of the once-per-incident state, the cameras the rule
    # has already alerted for and considers still offending
    notified_camera_ids: List[int]
    created_at: str


class CreateAlertRuleRequest(BaseModel):
    rule_type: str
    threshold: int
    camera_ids: Optional[List[int]] = None
    channels: List[str]


class UpdateAlertRuleRequest(BaseModel):
    rule_type: Optional[str] = None
    threshold: Optional[int] = None
    # Sentinel-free: omitting camera_ids keeps the stored scope, sending
    # null means all cameras. Pydantic cannot distinguish omitted from
    # null here, so the update endpoint treats null as "all cameras"
    # only when scope_all is true.
    camera_ids: Optional[List[int]] = None
    scope_all: Optional[bool] = None
    channels: Optional[List[str]] = None
    is_active: Optional[bool] = None


def _serialize(rule: CameraAlertRule) -> AlertRuleResponse:
    return AlertRuleResponse(
        id=rule.id,
        rule_type=rule.rule_type,
        threshold=rule.threshold,
        camera_ids=rule.camera_ids,
        channels=rule.channels,
        is_active=rule.is_active,
        notified_camera_ids=rule.notified_camera_ids or [],
        created_at=rule.created_at.isoformat(),
    )


async def _require_project_access(
    db: AsyncSession, current_user: User, project_id: int
) -> None:
    if not await can_access_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project access required",
        )
    project = (await db.execute(
        select(Project).where(Project.id == project_id)
    )).scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found",
        )


async def _check_cameras_in_project(
    db: AsyncSession, project_id: int, camera_ids: List[int]
) -> None:
    count = (await db.execute(
        select(func.count(Camera.id)).where(
            Camera.id.in_(camera_ids),
            Camera.project_id == project_id,
        )
    )).scalar()
    if count != len(set(camera_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All cameras must belong to this project",
        )


async def _load_own_rule(
    db: AsyncSession,
    project_id: int,
    rule_id: int,
    current_user: User,
) -> CameraAlertRule:
    """Fetch a rule owned by the current user. 404 (not 403) if it
    belongs to someone else, so other members' rules are not
    enumerable."""
    rule = (await db.execute(
        select(CameraAlertRule).where(
            and_(
                CameraAlertRule.id == rule_id,
                CameraAlertRule.project_id == project_id,
                CameraAlertRule.created_by_user_id == current_user.id,
            )
        )
    )).scalar_one_or_none()
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert rule not found",
        )
    return rule


@router.get(
    "/{project_id}/alert-rules",
    response_model=List[AlertRuleResponse],
)
async def list_alert_rules(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List the current user's own alert rules for a project."""
    await _require_project_access(db, current_user, project_id)

    rows = (await db.execute(
        select(CameraAlertRule)
        .where(
            CameraAlertRule.project_id == project_id,
            CameraAlertRule.created_by_user_id == current_user.id,
        )
        .order_by(CameraAlertRule.id.asc())
    )).scalars().all()

    return [_serialize(r) for r in rows]


@router.post(
    "/{project_id}/alert-rules",
    response_model=AlertRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_alert_rule(
    project_id: int,
    request: CreateAlertRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Create an alert rule. camera_ids null watches all cameras of the
    project, a non-empty list watches only those cameras."""
    await _require_project_access(db, current_user, project_id)

    error = validate_rule_fields(
        request.rule_type, request.threshold, request.channels, request.camera_ids
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    if request.camera_ids is not None:
        await _check_cameras_in_project(db, project_id, request.camera_ids)

    rule = CameraAlertRule(
        project_id=project_id,
        created_by_user_id=current_user.id,
        rule_type=request.rule_type,
        threshold=request.threshold,
        camera_ids=request.camera_ids,
        channels=request.channels,
        notified_camera_ids=[],
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return _serialize(rule)


@router.patch(
    "/{project_id}/alert-rules/{rule_id}",
    response_model=AlertRuleResponse,
)
async def update_alert_rule(
    project_id: int,
    rule_id: int,
    request: UpdateAlertRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Edit a rule. Changing what the rule measures (type, threshold, or
    camera scope) resets the once-per-incident state so the edited rule
    fires fresh on the next evaluation."""
    await _require_project_access(db, current_user, project_id)
    rule = await _load_own_rule(db, project_id, rule_id, current_user)

    next_type = request.rule_type if request.rule_type is not None else rule.rule_type
    next_threshold = request.threshold if request.threshold is not None else rule.threshold
    next_channels = request.channels if request.channels is not None else rule.channels
    if request.scope_all:
        next_camera_ids = None
    elif request.camera_ids is not None:
        next_camera_ids = request.camera_ids
    else:
        next_camera_ids = rule.camera_ids

    error = validate_rule_fields(next_type, next_threshold, next_channels, next_camera_ids)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    if next_camera_ids is not None and next_camera_ids != rule.camera_ids:
        await _check_cameras_in_project(db, project_id, next_camera_ids)

    # Order-insensitive camera comparison, reordering the same set is
    # not a condition change and must not reset the incident state
    def _normalized(ids):
        return sorted(ids) if ids else None

    condition_changed = (
        next_type != rule.rule_type
        or next_threshold != rule.threshold
        or _normalized(next_camera_ids) != _normalized(rule.camera_ids)
    )

    rule.rule_type = next_type
    rule.threshold = next_threshold
    rule.camera_ids = next_camera_ids
    rule.channels = next_channels
    if request.is_active is not None:
        rule.is_active = request.is_active
    if condition_changed:
        rule.notified_camera_ids = []

    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete(
    "/{project_id}/alert-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_alert_rule(
    project_id: int,
    rule_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Delete a rule. Hard delete, a standing rule needs no cancel
    audit, the notification log is the trail of what fired."""
    await _require_project_access(db, current_user, project_id)
    rule = await _load_own_rule(db, project_id, rule_id, current_user)
    await db.delete(rule)
    await db.commit()
