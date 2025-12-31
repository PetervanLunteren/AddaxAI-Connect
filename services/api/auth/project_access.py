"""
Project access control dependency

Provides functions to get accessible project IDs for the current user.
"""
from typing import List
from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, Project
from shared.database import get_async_session
from auth.users import current_active_user


async def get_accessible_project_ids(
    current_user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> List[int]:
    """
    Get list of project IDs accessible to the current user.

    Superusers: all project IDs
    Regular users: only their assigned project ID (if any)

    Args:
        current_user: Current authenticated user
        db: Database session

    Returns:
        List of accessible project IDs
    """
    if current_user.is_superuser:
        # Superusers can access all projects
        result = await db.execute(select(Project.id))
        project_ids = [row[0] for row in result.all()]
        return project_ids
    else:
        # Regular users can only access their assigned project
        if current_user.project_id:
            return [current_user.project_id]
        else:
            # User has no project assigned - return empty list
            return []
