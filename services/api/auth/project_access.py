"""
Project access control dependency

Provides functions to get accessible project IDs and the site scope for
the current user. The site scope is the allow-list of a site-restricted
project-viewer membership: None means unrestricted, a list means the
caller may only see those sites (see utils/site_scope.py).
"""
from typing import List, Optional
from fastapi import Depends, HTTPException, status as http_status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, Project, ProjectMembership
from shared.database import get_async_session
from auth.users import current_active_user
from auth.permissions import Role
from utils.site_scope import validate_membership_site_ids, sites_in_project


async def get_accessible_project_ids(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> List[int]:
    """
    Get list of project IDs accessible to the current user.

    Server admins: all project IDs
    Regular users: projects from their project_memberships

    Args:
        current_user: Current authenticated user
        db: Database session

    Returns:
        List of accessible project IDs
    """
    if current_user.is_superuser:
        # Server admins can access all projects
        result = await db.execute(select(Project.id))
        project_ids = [row[0] for row in result.all()]
        return project_ids
    else:
        # Regular users: get projects from memberships table
        result = await db.execute(
            select(ProjectMembership.project_id).where(
                ProjectMembership.user_id == current_user.id
            )
        )
        project_ids = [row[0] for row in result.all()]
        return project_ids


def narrow_to_project(
    accessible_project_ids: List[int],
    project_id: Optional[int],
) -> List[int]:
    """Narrow accessible project IDs to a single project if specified."""
    if project_id is None:
        return accessible_project_ids
    if project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )
    return [project_id]


async def get_allowed_site_ids(
    user: User,
    project_id: int,
    db: AsyncSession,
) -> Optional[List[int]]:
    """
    Get the site scope of the user in a project.

    None means unrestricted (server admin, project admin, or an unscoped
    viewer). A list means the user may only see those sites. No
    membership raises 403, fail closed, even where the endpoint already
    checked access.
    """
    if user.is_superuser:
        return None
    result = await db.execute(
        select(ProjectMembership.role, ProjectMembership.site_ids).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project_id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="No access to this project",
        )
    role, site_ids = row
    if role == Role.PROJECT_ADMIN:
        return None
    return site_ids


async def get_site_scope(
    project_id: int,
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> Optional[List[int]]:
    """Dependency form of get_allowed_site_ids for routers whose prefix
    contains {project_id}."""
    return await get_allowed_site_ids(current_user, project_id, db)


async def check_site_scope_or_400(
    db: AsyncSession,
    project_id: int,
    role: str,
    site_ids: Optional[List[int]],
) -> None:
    """Reject an invalid membership site scope with 400. Shared by every
    membership write path."""
    error = validate_membership_site_ids(role, site_ids)
    if error:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=error,
        )
    if site_ids and not await sites_in_project(db, project_id, site_ids):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="All sites must belong to this project",
        )


async def get_site_scope_or_400(
    user: User,
    project_id: Optional[int],
    db: AsyncSession,
) -> Optional[List[int]]:
    """
    Site scope for endpoints where project_id is an optional query param.

    Cross-project queries (project_id None) cannot express a per-project
    site scope, so they are refused with 400 when the caller has any
    site-restricted membership. The frontend always sends project_id, so
    this only triggers for direct API use.
    """
    if project_id is not None:
        return await get_allowed_site_ids(user, project_id, db)
    if user.is_superuser:
        return None
    result = await db.execute(
        select(ProjectMembership.id).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.site_ids.is_not(None),
        ).limit(1)
    )
    if result.first() is not None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="project_id is required for site-restricted accounts",
        )
    return None
