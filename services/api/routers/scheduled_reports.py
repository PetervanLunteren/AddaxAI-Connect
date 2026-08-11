"""
Scheduled species report rules.

Any project member creates private rules that email an analytical species
summary at a fixed rhythm. A rule names its labels (species plus
person/vehicle) and a frequency: weekly (sent Monday for the previous
week), monthly (sent on the 1st for the previous month), or quarterly
(sent on 1 Jan/Apr/Jul/Oct for the previous quarter). The notifications
worker generates and sends the emails; the creator is the only recipient
and other members never see the rules.

Site-restricted viewers cannot create rules: the report aggregates over
every site of the project, the same reason the project report emails are
blocked for them. The worker also skips them at send time, so a later
restriction cannot leak data through an older rule.

Routes are mounted under /api/projects/{project_id}/species-reports.
Every endpoint requires project access on the target project; ownership
is enforced with 404 (not 403) so rules of other members are not
enumerable, same convention as the other rule routers.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from shared.models import ScheduledReportRule, User
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.project_access import get_allowed_site_ids
from routers.rule_helpers import require_project_access, load_own_row


router = APIRouter(prefix="/api/projects", tags=["scheduled-reports"])

VALID_FREQUENCIES = {"weekly", "monthly", "quarterly"}


def validate_rule_fields(
    species: List[str],
    frequency: str,
) -> Optional[str]:
    """Validate rule fields, returning an error message or None.

    Pure so it is unit-testable without a database. Species strings are
    not checked against the model's label list; an unknown label simply
    reports zero detections.
    """
    if not species:
        return "at least one label is required"
    if not all(isinstance(s, str) and s for s in species):
        return "labels must be non-empty strings"
    if len(species) != len(set(species)):
        return "labels must not repeat"

    if frequency not in VALID_FREQUENCIES:
        return f"frequency must be one of {', '.join(sorted(VALID_FREQUENCIES))}"

    return None


class ScheduledReportResponse(BaseModel):
    id: int
    species: List[str]
    frequency: str
    is_active: bool
    created_at: str


class CreateScheduledReportRequest(BaseModel):
    species: List[str]
    frequency: str


class UpdateScheduledReportRequest(BaseModel):
    """Omitted fields keep the stored value, same convention as the other
    rule routers. species and frequency cannot be cleared."""
    species: Optional[List[str]] = None
    frequency: Optional[str] = None
    is_active: Optional[bool] = None


def _serialize(rule: ScheduledReportRule) -> ScheduledReportResponse:
    return ScheduledReportResponse(
        id=rule.id,
        species=rule.species,
        frequency=rule.frequency,
        is_active=rule.is_active,
        created_at=rule.created_at.isoformat(),
    )


async def _reject_site_restricted_viewer(
    db: AsyncSession, current_user: User, project_id: int
) -> None:
    """403 for site-restricted viewers. The report sums over every site
    of the project, so a scoped viewer must not be able to order one,
    the same rule as the project report emails."""
    site_scope = await get_allowed_site_ids(current_user, project_id, db)
    if site_scope is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Species reports cover the whole project and are not available for site-restricted access",
        )


@router.get(
    "/{project_id}/species-reports",
    response_model=List[ScheduledReportResponse],
)
async def list_scheduled_reports(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List the current user's own species report rules for a project."""
    await require_project_access(db, current_user, project_id)

    rows = (await db.execute(
        select(ScheduledReportRule)
        .where(
            ScheduledReportRule.project_id == project_id,
            ScheduledReportRule.created_by_user_id == current_user.id,
        )
        .order_by(ScheduledReportRule.id.asc())
    )).scalars().all()

    return [_serialize(r) for r in rows]


@router.post(
    "/{project_id}/species-reports",
    response_model=ScheduledReportResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_scheduled_report(
    project_id: int,
    request: CreateScheduledReportRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Create a species report rule."""
    await require_project_access(db, current_user, project_id)
    await _reject_site_restricted_viewer(db, current_user, project_id)

    error = validate_rule_fields(request.species, request.frequency)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    rule = ScheduledReportRule(
        project_id=project_id,
        created_by_user_id=current_user.id,
        species=request.species,
        frequency=request.frequency,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)

    return _serialize(rule)


@router.patch(
    "/{project_id}/species-reports/{rule_id}",
    response_model=ScheduledReportResponse,
)
async def update_scheduled_report(
    project_id: int,
    rule_id: int,
    request: UpdateScheduledReportRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Edit a rule. There is no delivery state to reset; the next due
    date follows from the frequency alone."""
    await require_project_access(db, current_user, project_id)
    rule = await load_own_row(db, ScheduledReportRule, project_id, rule_id, current_user, "Species report not found")

    sent = request.model_fields_set

    next_species = request.species if 'species' in sent else rule.species
    next_frequency = request.frequency if 'frequency' in sent else rule.frequency

    if next_species is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="species cannot be null",
        )
    if next_frequency is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="frequency cannot be null",
        )

    error = validate_rule_fields(next_species, next_frequency)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    rule.species = next_species
    rule.frequency = next_frequency
    if request.is_active is not None:
        rule.is_active = request.is_active

    await db.commit()
    await db.refresh(rule)
    return _serialize(rule)


@router.delete(
    "/{project_id}/species-reports/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_scheduled_report(
    project_id: int,
    rule_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Delete a rule. Hard delete, a standing rule needs no cancel
    audit, the notification log is the trail of what was sent."""
    await require_project_access(db, current_user, project_id)
    rule = await load_own_row(db, ScheduledReportRule, project_id, rule_id, current_user, "Species report not found")
    await db.delete(rule)
    await db.commit()
