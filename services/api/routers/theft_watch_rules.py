"""
Theft watch rules (beta).

Any project member creates private theft watch rules. One rule carries
two triggers, a real-time person outlier alert and an hourly adaptive
silence alert, with a low/medium/high sensitivity preset, optionally
narrowed by site. Rules are evaluated by the notifications service; the
creator is the only recipient and other members never see the rules.

Routes are mounted under /api/projects/{project_id}/theft-watch-rules.
Every endpoint requires project access on the target project; ownership
is enforced with 404 (not 403) so rules of other members are not
enumerable, same convention as the other rule routers.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from shared.models import Site, TheftWatchRule, User
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.project_access import get_allowed_site_ids
from routers.rule_helpers import (
    VALID_CHANNELS,
    check_earthranger_channel,
    list_rule_rows,
    load_rule_row,
    require_project_access,
)


router = APIRouter(prefix="/api/projects", tags=["theft-watch-rules"])

VALID_SENSITIVITIES = {"low", "medium", "high"}


def validate_rule_fields(
    sensitivity: str,
    site_ids: Optional[List[int]],
    channels: List[str],
) -> Optional[str]:
    """Validate rule fields, returning an error message or None.

    Pure so it is unit-testable without a database. The site-ids
    project-membership check needs the database and lives in the
    endpoints.
    """
    if sensitivity not in VALID_SENSITIVITIES:
        return "sensitivity must be low, medium, or high"

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

    return None


class TheftWatchRuleResponse(BaseModel):
    id: int
    sensitivity: str
    site_ids: Optional[List[int]] = None
    channels: List[str]
    is_active: bool
    created_at: str


class CreateTheftWatchRuleRequest(BaseModel):
    sensitivity: str
    site_ids: Optional[List[int]] = None
    channels: List[str]


class UpdateTheftWatchRuleRequest(BaseModel):
    """Omitted fields keep the stored value; an explicitly sent null
    site_ids widens the scope to all sites. Distinguished via
    model_fields_set, same convention as the detection rules."""
    sensitivity: Optional[str] = None
    site_ids: Optional[List[int]] = None
    channels: Optional[List[str]] = None
    is_active: Optional[bool] = None


def _serialize(rule: TheftWatchRule) -> TheftWatchRuleResponse:
    return TheftWatchRuleResponse(
        id=rule.id,
        sensitivity=rule.sensitivity,
        site_ids=rule.site_ids,
        channels=rule.channels,
        is_active=rule.is_active,
        created_at=rule.created_at.isoformat(),
    )


async def _check_sites_in_scope(
    db: AsyncSession, current_user: User, project_id: int,
    site_ids: Optional[List[int]],
) -> None:
    """400 when a site-restricted viewer names a site outside their scope.

    A null site list (all sites) is allowed and stays null; the worker
    clamps it to the allow-list at evaluation time, so the stored rule
    keeps its single representation.
    """
    if site_ids is None:
        return
    site_scope = await get_allowed_site_ids(current_user, project_id, db)
    if site_scope is None:
        return
    if any(s not in site_scope for s in site_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All sites must be within your allowed sites",
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


@router.get(
    "/{project_id}/theft-watch-rules",
    response_model=List[TheftWatchRuleResponse],
)
async def list_theft_watch_rules(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
    channel: Optional[str] = None,
):
    """List the current user's own rules for a project. With
    channel=earthranger (project admins), every rule of the project that
    sends to EarthRanger, for the integration page."""
    await require_project_access(db, current_user, project_id)
    rows = await list_rule_rows(db, TheftWatchRule, project_id, current_user, channel)
    return [_serialize(r) for r in rows]


@router.post(
    "/{project_id}/theft-watch-rules",
    response_model=TheftWatchRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_theft_watch_rule(
    project_id: int,
    request: CreateTheftWatchRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Create a theft watch rule. site_ids null watches all sites of the
    project, a non-empty list watches only those sites."""
    await require_project_access(db, current_user, project_id)

    error = validate_rule_fields(
        request.sensitivity, request.site_ids, request.channels,
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    await check_earthranger_channel(db, current_user, project_id, request.channels)

    if request.site_ids is not None:
        await _check_sites_in_project(db, project_id, request.site_ids)
    await _check_sites_in_scope(db, current_user, project_id, request.site_ids)

    rule = TheftWatchRule(
        project_id=project_id,
        created_by_user_id=current_user.id,
        sensitivity=request.sensitivity,
        site_ids=request.site_ids,
        channels=request.channels,
        person_cooldown_state={},
        notified_camera_ids=[],
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return _serialize(rule)


@router.patch(
    "/{project_id}/theft-watch-rules/{rule_id}",
    response_model=TheftWatchRuleResponse,
)
async def update_theft_watch_rule(
    project_id: int,
    rule_id: int,
    request: UpdateTheftWatchRuleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Edit a rule. Changing what the rule watches (sensitivity or scope)
    resets both trigger states so the edited rule fires fresh."""
    await require_project_access(db, current_user, project_id)
    rule = await load_rule_row(db, TheftWatchRule, project_id, rule_id, current_user, "Theft watch rule not found")

    sent = request.model_fields_set

    def _next(field: str, current):
        return getattr(request, field) if field in sent else current

    next_sensitivity = _next('sensitivity', rule.sensitivity)
    next_site_ids = _next('site_ids', rule.site_ids)
    next_channels = _next('channels', rule.channels)

    if next_sensitivity is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="sensitivity cannot be null",
        )
    if next_channels is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="channels cannot be null",
        )

    error = validate_rule_fields(next_sensitivity, next_site_ids, next_channels)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
    await check_earthranger_channel(db, current_user, project_id, next_channels, rule.channels)

    if next_site_ids is not None and next_site_ids != rule.site_ids:
        await _check_sites_in_project(db, project_id, next_site_ids)
    await _check_sites_in_scope(db, current_user, project_id, next_site_ids)

    # Order-insensitive comparison, reordering the same set is not a
    # condition change and must not reset the trigger states
    def _normalized(values):
        return sorted(values) if values else None

    condition_changed = (
        next_sensitivity != rule.sensitivity
        or _normalized(next_site_ids) != _normalized(rule.site_ids)
    )

    rule.sensitivity = next_sensitivity
    rule.site_ids = next_site_ids
    rule.channels = next_channels
    if request.is_active is not None:
        rule.is_active = request.is_active
    if condition_changed:
        rule.person_cooldown_state = {}
        rule.notified_camera_ids = []

    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete(
    "/{project_id}/theft-watch-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_theft_watch_rule(
    project_id: int,
    rule_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Delete a rule. Hard delete, a standing rule needs no cancel
    audit, the notification log is the trail of what fired."""
    await require_project_access(db, current_user, project_id)
    rule = await load_rule_row(db, TheftWatchRule, project_id, rule_id, current_user, "Theft watch rule not found")
    await db.delete(rule)
    await db.commit()
