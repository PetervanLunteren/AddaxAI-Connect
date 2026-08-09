"""
Real-time detection alert rules.

Any project member creates private rules for species detections. A rule
names its labels (species plus person/vehicle) and optionally narrows by
site, time of day, minimum group size, a cooldown, and a rarity
lookback. Rules are evaluated on the live event path by the
notifications service; the creator is the only recipient and other
members never see the rules.

Routes are mounted under /api/projects/{project_id}/detection-rules.
Every endpoint requires project access on the target project; ownership
is enforced with 404 (not 403) so rules of other members are not
enumerable, same convention as the camera alert rules.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from shared.models import DetectionAlertRule, Project, Site, User
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_access_project


router = APIRouter(prefix="/api/projects", tags=["detection-alert-rules"])

VALID_CHANNELS = {"email", "telegram"}


def validate_rule_fields(
    species: List[str],
    site_ids: Optional[List[int]],
    channels: List[str],
    hour_from: Optional[int],
    hour_to: Optional[int],
    min_group_size: Optional[int],
    cooldown_minutes: Optional[int],
    rarity_days: Optional[int],
) -> Optional[str]:
    """Validate rule fields, returning an error message or None.

    Pure so it is unit-testable without a database. The site-ids
    project-membership check needs the database and lives in the
    endpoints. Species strings are not checked against the model's label
    list; an unknown label simply never matches an event.
    """
    if not species:
        return "at least one label is required"
    if not all(isinstance(s, str) and s for s in species):
        return "labels must be non-empty strings"
    if len(species) != len(set(species)):
        return "labels must not repeat"

    if site_ids is not None:
        # An empty list is rejected so "all sites" has exactly one
        # representation, null
        if not site_ids:
            return "site_ids must be null for all sites, or a non-empty list"
        if not all(isinstance(s, int) for s in site_ids):
            return "site_ids must be integers"
        if len(site_ids) != len(set(site_ids)):
            return "site_ids must not repeat"

    if not channels:
        return "at least one channel is required"
    if len(channels) != len(set(channels)):
        return "channels must not repeat"
    invalid = set(channels) - VALID_CHANNELS
    if invalid:
        return f"unknown channels {', '.join(sorted(invalid))}"

    if (hour_from is None) != (hour_to is None):
        return "hour_from and hour_to must be set together"
    if hour_from is not None:
        if not (0 <= hour_from <= 23) or not (0 <= hour_to <= 23):
            return "hours must be between 0 and 23"
        if hour_from == hour_to:
            return "hour_from and hour_to must differ; leave both empty for the whole day"

    if min_group_size is not None and not (2 <= min_group_size <= 100):
        return "min_group_size must be between 2 and 100"

    if cooldown_minutes is not None and not (1 <= cooldown_minutes <= 10080):
        return "cooldown_minutes must be between 1 and 10080"

    if rarity_days is not None and not (1 <= rarity_days <= 3650):
        return "rarity_days must be between 1 and 3650"

    return None


class DetectionRuleResponse(BaseModel):
    id: int
    species: List[str]
    site_ids: Optional[List[int]] = None
    channels: List[str]
    hour_from: Optional[int] = None
    hour_to: Optional[int] = None
    min_group_size: Optional[int] = None
    cooldown_minutes: Optional[int] = None
    rarity_days: Optional[int] = None
    is_active: bool
    created_at: str


class CreateDetectionRuleRequest(BaseModel):
    species: List[str]
    site_ids: Optional[List[int]] = None
    channels: List[str]
    hour_from: Optional[int] = None
    hour_to: Optional[int] = None
    min_group_size: Optional[int] = None
    cooldown_minutes: Optional[int] = None
    rarity_days: Optional[int] = None


class UpdateDetectionRuleRequest(BaseModel):
    """Omitted fields keep the stored value; an explicitly sent null
    clears the condition (or widens the scope to all sites). Distinguished
    via model_fields_set, same convention as the camera SIM expiry date."""
    species: Optional[List[str]] = None
    site_ids: Optional[List[int]] = None
    channels: Optional[List[str]] = None
    hour_from: Optional[int] = None
    hour_to: Optional[int] = None
    min_group_size: Optional[int] = None
    cooldown_minutes: Optional[int] = None
    rarity_days: Optional[int] = None
    is_active: Optional[bool] = None


def _serialize(rule: DetectionAlertRule) -> DetectionRuleResponse:
    return DetectionRuleResponse(
        id=rule.id,
        species=rule.species,
        site_ids=rule.site_ids,
        channels=rule.channels,
        hour_from=rule.hour_from,
        hour_to=rule.hour_to,
        min_group_size=rule.min_group_size,
        cooldown_minutes=rule.cooldown_minutes,
        rarity_days=rule.rarity_days,
        is_active=rule.is_active,
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


async def _check_sites_in_project(
    db: AsyncSession, project_id: int, site_ids: List[int]
) -> None:
    count = (await db.execute(
        select(func.count(Site.id)).where(
            Site.id.in_(site_ids),
            Site.project_id == project_id,
        )
    )).scalar()
    if count != len(set(site_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All sites must belong to this project",
        )


async def _load_own_rule(
    db: AsyncSession,
    project_id: int,
    rule_id: int,
    current_user: User,
) -> DetectionAlertRule:
    """Fetch a rule owned by the current user. 404 (not 403) if it
    belongs to someone else, so other members' rules are not
    enumerable."""
    rule = (await db.execute(
        select(DetectionAlertRule).where(
            and_(
                DetectionAlertRule.id == rule_id,
                DetectionAlertRule.project_id == project_id,
                DetectionAlertRule.created_by_user_id == current_user.id,
            )
        )
    )).scalar_one_or_none()
    if not rule:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Detection rule not found",
        )
    return rule


@router.get(
    "/{project_id}/detection-rules",
    response_model=List[DetectionRuleResponse],
)
async def list_detection_rules(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List the current user's own detection rules for a project."""
    await _require_project_access(db, current_user, project_id)

    rows = (await db.execute(
        select(DetectionAlertRule)
        .where(
            DetectionAlertRule.project_id == project_id,
            DetectionAlertRule.created_by_user_id == current_user.id,
        )
        .order_by(DetectionAlertRule.id.asc())
    )).scalars().all()

    return [_serialize(r) for r in rows]


@router.post(
    "/{project_id}/detection-rules",
    response_model=DetectionRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_detection_rule(
    project_id: int,
    request: CreateDetectionRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Create a detection rule. site_ids null watches all sites of the
    project, a non-empty list watches only those sites."""
    await _require_project_access(db, current_user, project_id)

    error = validate_rule_fields(
        request.species, request.site_ids, request.channels,
        request.hour_from, request.hour_to,
        request.min_group_size, request.cooldown_minutes, request.rarity_days,
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    if request.site_ids is not None:
        await _check_sites_in_project(db, project_id, request.site_ids)

    rule = DetectionAlertRule(
        project_id=project_id,
        created_by_user_id=current_user.id,
        species=request.species,
        site_ids=request.site_ids,
        channels=request.channels,
        hour_from=request.hour_from,
        hour_to=request.hour_to,
        min_group_size=request.min_group_size,
        cooldown_minutes=request.cooldown_minutes,
        rarity_days=request.rarity_days,
        cooldown_state={},
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return _serialize(rule)


@router.patch(
    "/{project_id}/detection-rules/{rule_id}",
    response_model=DetectionRuleResponse,
)
async def update_detection_rule(
    project_id: int,
    rule_id: int,
    request: UpdateDetectionRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Edit a rule. Changing what the rule matches (labels, scope, or any
    condition) resets the cooldown state so the edited rule fires fresh."""
    await _require_project_access(db, current_user, project_id)
    rule = await _load_own_rule(db, project_id, rule_id, current_user)

    sent = request.model_fields_set

    def _next(field: str, current):
        return getattr(request, field) if field in sent else current

    next_species = _next('species', rule.species)
    next_site_ids = _next('site_ids', rule.site_ids)
    next_channels = _next('channels', rule.channels)
    next_hour_from = _next('hour_from', rule.hour_from)
    next_hour_to = _next('hour_to', rule.hour_to)
    next_min_group_size = _next('min_group_size', rule.min_group_size)
    next_cooldown_minutes = _next('cooldown_minutes', rule.cooldown_minutes)
    next_rarity_days = _next('rarity_days', rule.rarity_days)

    if next_species is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="species cannot be null",
        )
    if next_channels is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="channels cannot be null",
        )

    error = validate_rule_fields(
        next_species, next_site_ids, next_channels,
        next_hour_from, next_hour_to,
        next_min_group_size, next_cooldown_minutes, next_rarity_days,
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    if next_site_ids is not None and next_site_ids != rule.site_ids:
        await _check_sites_in_project(db, project_id, next_site_ids)

    # Order-insensitive comparison, reordering the same set is not a
    # condition change and must not reset the cooldown state
    def _normalized(values):
        return sorted(values) if values else None

    condition_changed = (
        _normalized(next_species) != _normalized(rule.species)
        or _normalized(next_site_ids) != _normalized(rule.site_ids)
        or next_hour_from != rule.hour_from
        or next_hour_to != rule.hour_to
        or next_min_group_size != rule.min_group_size
        or next_cooldown_minutes != rule.cooldown_minutes
        or next_rarity_days != rule.rarity_days
    )

    rule.species = next_species
    rule.site_ids = next_site_ids
    rule.channels = next_channels
    rule.hour_from = next_hour_from
    rule.hour_to = next_hour_to
    rule.min_group_size = next_min_group_size
    rule.cooldown_minutes = next_cooldown_minutes
    rule.rarity_days = next_rarity_days
    if request.is_active is not None:
        rule.is_active = request.is_active
    if condition_changed:
        rule.cooldown_state = {}

    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete(
    "/{project_id}/detection-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_detection_rule(
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
