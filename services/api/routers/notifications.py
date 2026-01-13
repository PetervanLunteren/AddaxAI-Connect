"""
Project notification preferences endpoints.

Authenticated users can manage their notification settings per project.
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel

from shared.models import User, ProjectNotificationPreference, Project
from shared.database import get_async_session
from auth.users import current_active_user


router = APIRouter(prefix="/api/projects", tags=["notifications"])


class NotificationPreferenceResponse(BaseModel):
    """Response for notification preferences"""
    # Legacy fields (deprecated but kept for backward compatibility)
    enabled: bool
    notify_species: Optional[List[str]]
    notify_low_battery: bool
    battery_threshold: int
    notify_system_health: bool

    # Multi-channel fields
    telegram_chat_id: Optional[str] = None
    notification_channels: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True


class NotificationPreferenceUpdateRequest(BaseModel):
    """Request to update notification preferences"""
    # Legacy fields (deprecated but kept for backward compatibility)
    enabled: Optional[bool] = None
    notify_species: Optional[List[str]] = None  # List of species IDs/names, None = all
    notify_low_battery: Optional[bool] = None
    battery_threshold: Optional[int] = None  # 0-100
    notify_system_health: Optional[bool] = None

    # Multi-channel fields
    telegram_chat_id: Optional[str] = None
    notification_channels: Optional[Dict[str, Any]] = None


@router.get(
    "/{project_id}/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def get_notification_preferences(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get current user's notification preferences for a specific project.

    Returns the authenticated user's notification settings for the given project.
    If preferences don't exist yet, returns defaults.

    Args:
        project_id: ID of the project
        db: Database session
        current_user: Current authenticated user

    Returns:
        User's notification preferences for this project

    Raises:
        HTTPException 403: If user doesn't have access to this project
        HTTPException 404: If project doesn't exist
    """
    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Verify user has access (either assigned to project or is superuser)
    if not current_user.is_superuser and current_user.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project"
        )

    # Get preferences
    result = await db.execute(
        select(ProjectNotificationPreference).where(
            and_(
                ProjectNotificationPreference.user_id == current_user.id,
                ProjectNotificationPreference.project_id == project_id
            )
        )
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # Return default preferences if none exist
        return NotificationPreferenceResponse(
            enabled=False,
            notify_species=None,
            notify_low_battery=True,
            battery_threshold=30,
            notify_system_health=False,
        )

    return prefs


@router.put(
    "/{project_id}/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def update_notification_preferences(
    project_id: int,
    data: NotificationPreferenceUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Update current user's notification preferences for a specific project.

    Creates or updates the authenticated user's notification settings for the given project.
    Only provided fields will be updated.

    Args:
        project_id: ID of the project
        data: Notification preference updates
        db: Database session
        current_user: Current authenticated user

    Returns:
        Updated notification preferences

    Raises:
        HTTPException 400: If validation fails (e.g., invalid battery threshold)
        HTTPException 403: If user doesn't have access to this project
        HTTPException 404: If project doesn't exist
    """
    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found"
        )

    # Verify user has access (either assigned to project or is superuser)
    if not current_user.is_superuser and current_user.project_id != project_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project"
        )

    # Validate battery threshold if provided
    if data.battery_threshold is not None:
        if not 0 <= data.battery_threshold <= 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Battery threshold must be between 0 and 100"
            )

    # Get or create preferences
    result = await db.execute(
        select(ProjectNotificationPreference).where(
            and_(
                ProjectNotificationPreference.user_id == current_user.id,
                ProjectNotificationPreference.project_id == project_id
            )
        )
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # Create new preferences with defaults
        prefs = ProjectNotificationPreference(
            user_id=current_user.id,
            project_id=project_id,
            enabled=False,
            notify_species=None,
            notify_low_battery=True,
            battery_threshold=30,
            notify_system_health=False,
        )
        db.add(prefs)

    # Update provided fields
    if data.enabled is not None:
        prefs.enabled = data.enabled
    if data.notify_species is not None:
        prefs.notify_species = data.notify_species
    if data.notify_low_battery is not None:
        prefs.notify_low_battery = data.notify_low_battery
    if data.battery_threshold is not None:
        prefs.battery_threshold = data.battery_threshold
    if data.notify_system_health is not None:
        prefs.notify_system_health = data.notify_system_health

    # Update new multi-channel fields
    if data.telegram_chat_id is not None:
        prefs.telegram_chat_id = data.telegram_chat_id
    if data.notification_channels is not None:
        prefs.notification_channels = data.notification_channels

    await db.commit()
    await db.refresh(prefs)

    return prefs
