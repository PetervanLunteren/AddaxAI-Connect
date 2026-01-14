"""
Role-based permission checking for multi-project access control.

Provides helper functions and FastAPI dependencies for checking user permissions:
- Server admin: Full access to all projects and system administration
- Project admin: Can manage specific projects (cameras, species, users)
- Project viewer: Read-only access to specific projects

Design principles:
- Crash early and loudly if permissions are violated
- Explicit permission checks on every endpoint
- No implicit access - all access must be validated
"""
from enum import Enum
from typing import Optional
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, ProjectMembership, Project
from shared.database import get_async_session
from auth.users import current_active_user


class Role(str, Enum):
    """
    User roles in the system.

    project-viewer: Read-only access to assigned projects
    project-admin: Full management access to assigned projects
    server-admin: Full access to everything (not stored in memberships table)
    """
    PROJECT_VIEWER = "project-viewer"
    PROJECT_ADMIN = "project-admin"
    SERVER_ADMIN = "server-admin"  # For display/comparison only, not in database


def is_server_admin(user: User) -> bool:
    """
    Check if user is a server admin.

    Server admins have implicit access to all projects and can perform
    system-level administration tasks.

    Args:
        user: User instance

    Returns:
        True if user is server admin, False otherwise
    """
    return user.is_server_admin


async def get_user_project_role(
    user: User,
    project_id: int,
    db: AsyncSession
) -> Optional[str]:
    """
    Get user's role in a specific project.

    Server admins automatically have 'server-admin' role for all projects.
    Regular users' roles are looked up in the project_memberships table.

    Args:
        user: User instance
        project_id: Project ID to check access for
        db: Database session

    Returns:
        Role string ('project-admin', 'project-viewer', 'server-admin')
        or None if user has no access to project
    """
    # Server admins have implicit access to all projects
    if user.is_server_admin:
        return Role.SERVER_ADMIN

    # Query project_memberships table
    result = await db.execute(
        select(ProjectMembership.role).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project_id
        )
    )
    return result.scalar_one_or_none()


async def get_user_projects_with_roles(
    user: User,
    db: AsyncSession
) -> list[dict]:
    """
    Get all projects user has access to with their roles.

    Returns list of dicts with project_id and role.
    Server admins get all projects with 'server-admin' role.
    Regular users get only their assigned projects from memberships table.

    Args:
        user: User instance
        db: Database session

    Returns:
        List of dicts: [{"project_id": 1, "role": "project-admin"}, ...]
    """
    if user.is_server_admin:
        # Server admins have access to all projects
        result = await db.execute(select(Project.id))
        project_ids = [row[0] for row in result.all()]
        return [{"project_id": pid, "role": Role.SERVER_ADMIN} for pid in project_ids]

    # Get projects from memberships
    result = await db.execute(
        select(ProjectMembership.project_id, ProjectMembership.role).where(
            ProjectMembership.user_id == user.id
        )
    )
    return [{"project_id": row[0], "role": row[1]} for row in result.all()]


async def can_access_project(
    user: User,
    project_id: int,
    db: AsyncSession
) -> bool:
    """
    Check if user has any access to project (viewer, admin, or server admin).

    Args:
        user: User instance
        project_id: Project ID to check
        db: Database session

    Returns:
        True if user has any role in project, False otherwise
    """
    role = await get_user_project_role(user, project_id, db)
    return role is not None


async def can_admin_project(
    user: User,
    project_id: int,
    db: AsyncSession
) -> bool:
    """
    Check if user can administer project (project-admin or server-admin).

    Args:
        user: User instance
        project_id: Project ID to check
        db: Database session

    Returns:
        True if user is admin of project, False otherwise
    """
    role = await get_user_project_role(user, project_id, db)
    return role in [Role.SERVER_ADMIN, Role.PROJECT_ADMIN]


# FastAPI dependencies for route protection

async def require_server_admin(
    user: User = Depends(current_active_user)
) -> User:
    """
    Require server admin access for this endpoint.

    Crashes with 403 if user is not a server admin.
    Use this for system-level administration endpoints.

    Args:
        user: Current authenticated user (injected by FastAPI)

    Returns:
        User instance if authorized

    Raises:
        HTTPException 403 if user is not server admin
    """
    if not is_server_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server admin access required"
        )
    return user


async def require_project_access(
    project_id: int,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Require any access to project (viewer, admin, or server admin).

    Crashes with 403 if user has no access to the specified project.
    Use this for read-only endpoints that should be accessible to all project members.

    Args:
        project_id: Project ID to check access for
        user: Current authenticated user (injected by FastAPI)
        db: Database session (injected by FastAPI)

    Returns:
        User instance if authorized

    Raises:
        HTTPException 403 if user has no access to project
    """
    if not await can_access_project(user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You do not have access to project {project_id}"
        )
    return user


async def require_project_admin_access(
    project_id: int,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session)
) -> User:
    """
    Require project admin access for this endpoint.

    Crashes with 403 if user is not an admin of the specified project.
    Use this for write endpoints (create/update/delete cameras, manage species, etc).

    Args:
        project_id: Project ID to check admin access for
        user: Current authenticated user (injected by FastAPI)
        db: Database session (injected by FastAPI)

    Returns:
        User instance if authorized

    Raises:
        HTTPException 403 if user is not admin of project
    """
    if not await can_admin_project(user, project_id, db):
        role = await get_user_project_role(user, project_id, db)
        if role == Role.PROJECT_VIEWER:
            detail = f"Project admin access required. You are a viewer in project {project_id}."
        elif role is None:
            detail = f"You do not have access to project {project_id}"
        else:
            detail = f"Project admin access required for project {project_id}"

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail
        )
    return user
