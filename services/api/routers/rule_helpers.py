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

from shared.models import Project, User
from auth.permissions import can_access_project


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
