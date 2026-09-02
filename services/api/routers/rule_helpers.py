"""
Shared helpers for the per-user rule routers.

Camera alert rules, detection alert rules, and scheduled species reports
all follow the same pattern: private rows owned by their creator, project
access required on every endpoint, and ownership enforced with 404 (not
403) so rules of other members are not enumerable. The two checks that
are identical across those routers live here.
"""
from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Project, ProjectIntegration, User
from auth.permissions import can_access_project, can_admin_project

# Delivery channels a rule may name. Email and Telegram reach the rule's
# creator; earthranger reaches the project's EarthRanger site through Gundi
# and is therefore a project-level choice (see check_earthranger_channel).
EARTHRANGER = "earthranger"
VALID_CHANNELS = {"email", "telegram", EARTHRANGER}


async def require_project_access(
    db: AsyncSession, current_user: User, project_id: int
) -> None:
    """403 without project access, 404 when the project does not exist."""
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


async def load_own_row(
    db: AsyncSession,
    model,
    project_id: int,
    row_id: int,
    current_user: User,
    not_found_detail: str,
):
    """Fetch a rule row owned by the current user. 404 (not 403) if it
    belongs to someone else, so other members' rules are not enumerable.

    model must have id, project_id, and created_by_user_id columns.
    """
    row = (await db.execute(
        select(model).where(
            and_(
                model.id == row_id,
                model.project_id == project_id,
                model.created_by_user_id == current_user.id,
            )
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=not_found_detail,
        )
    return row


async def require_project_admin(
    db: AsyncSession, current_user: User, project_id: int
) -> None:
    """403 unless the user administers the project (or the server)."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )


def is_project_rule(channels) -> bool:
    """A rule that sends to EarthRanger belongs to the project (managed on
    the integration page), not to the person who made it."""
    return EARTHRANGER in (channels or [])


async def check_earthranger_channel(
    db: AsyncSession,
    current_user: User,
    project_id: int,
    channels,
    current_channels=None,
) -> None:
    """A rule that sends to EarthRanger reaches the whole ranger team, not
    its creator, so only project admins may pick that channel, and only on
    a project whose EarthRanger integration is set up and enabled.

    The channel is exclusive: the notifications page and the integration
    page are separate worlds, so one rule never mixes personal channels
    with earthranger.

    A rule that already has the channel skips the integration check, so
    pausing or editing it keeps working after a disconnect; delivery
    itself is skipped safely by the worker in that state.
    """
    if EARTHRANGER not in (channels or []):
        return
    if len(channels) > 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="earthranger cannot be combined with other channels",
        )
    if is_project_rule(current_channels):
        return
    await require_project_admin(db, current_user, project_id)
    integration = (await db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == EARTHRANGER,
            ProjectIntegration.is_enabled == True,
        )
    )).scalar_one_or_none()
    if not integration:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="EarthRanger is not set up for this project",
        )


async def load_rule_row(
    db: AsyncSession,
    model,
    project_id: int,
    row_id: int,
    current_user: User,
    not_found_detail: str,
):
    """Like load_own_row, but a rule with the earthranger channel is a
    project rule: any project admin may edit or delete it, whoever made
    it. Other people's personal rules stay a 404."""
    row = (await db.execute(
        select(model).where(
            and_(model.id == row_id, model.project_id == project_id)
        )
    )).scalar_one_or_none()
    if row and row.created_by_user_id != current_user.id:
        if not (is_project_rule(row.channels) and await can_admin_project(current_user, project_id, db)):
            row = None
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=not_found_detail,
        )
    return row


async def list_rule_rows(
    db: AsyncSession, model, project_id: int, current_user: User, channel
):
    """Rows for a rule list. Without a channel filter, the caller's own
    rules. With channel=earthranger, every rule of the project on that
    channel, for the integration page; project admins only."""
    if channel is None:
        query = select(model).where(
            model.project_id == project_id,
            model.created_by_user_id == current_user.id,
        )
    elif channel == EARTHRANGER:
        await require_project_admin(db, current_user, project_id)
        query = select(model).where(model.project_id == project_id)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"unknown channel {channel}",
        )
    rows = (await db.execute(query.order_by(model.id.asc()))).scalars().all()
    if channel == EARTHRANGER:
        rows = [r for r in rows if is_project_rule(r.channels)]
    else:
        # Project rules live on the integration page; the notifications
        # page is personal and must not show them, not even to their maker
        rows = [r for r in rows if not is_project_rule(r.channels)]
    return rows
