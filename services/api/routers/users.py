"""
User endpoints for accessing user-specific data.

Provides endpoints for users to:
- Get their own project memberships with roles
"""
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Project, ProjectMembership
from shared.database import get_async_session
from auth.users import current_active_user


router = APIRouter(prefix="/api/users", tags=["users"])


class ProjectWithRole(BaseModel):
    """Project information with user's role"""
    id: int
    name: str
    description: str | None = None
    role: str
    image_url: str | None = None
    thumbnail_url: str | None = None


class UserProjectsResponse(BaseModel):
    """Response for user's project memberships"""
    projects: List[ProjectWithRole]


@router.get(
    "/me/projects",
    response_model=UserProjectsResponse,
)
async def get_my_projects(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Get current user's project memberships with roles

    Returns list of projects the user has access to along with their role in each project.
    Server admins receive all projects with 'server-admin' role.

    Args:
        current_user: Current authenticated user
        db: Database session

    Returns:
        List of projects with user's role in each
    """
    projects_with_roles = []

    if current_user.is_server_admin:
        # Server admins get all projects with server-admin role
        result = await db.execute(select(Project))
        projects = result.scalars().all()

        for project in projects:
            projects_with_roles.append(
                ProjectWithRole(
                    id=project.id,
                    name=project.name,
                    description=project.description,
                    role="server-admin",
                    image_url=None,  # TODO: Add image URL building
                    thumbnail_url=None,
                )
            )
    else:
        # Regular users: get projects from memberships
        query = (
            select(ProjectMembership, Project)
            .join(Project, ProjectMembership.project_id == Project.id)
            .where(ProjectMembership.user_id == current_user.id)
        )
        result = await db.execute(query)
        memberships = result.all()

        for membership, project in memberships:
            projects_with_roles.append(
                ProjectWithRole(
                    id=project.id,
                    name=project.name,
                    description=project.description,
                    role=membership.role,
                    image_url=None,  # TODO: Add image URL building
                    thumbnail_url=None,
                )
            )

    return UserProjectsResponse(projects=projects_with_roles)
