"""
Project notification preferences endpoints.

Authenticated users can manage their notification settings per project.
"""
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel

from shared.models import User, ProjectNotificationPreference, Project, Camera
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_access_project, can_admin_project


# Notification toggles that only project admins (or server admins) may flip.
# Non-admins who try to change these keys are rejected with 403 even if the
# frontend hides the row, so the API does not rely on the UI for enforcement.
ADMIN_ONLY_NOTIFICATION_KEYS = {"sim_expiry", "project_inactivity"}


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
    current_user: User = Depends(current_verified_user),
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

    # Verify user has access (project member or server admin)
    if not await can_access_project(current_user, project_id, db):
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
    current_user: User = Depends(current_verified_user),
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

    # Verify user has access (project member or server admin)
    if not await can_access_project(current_user, project_id, db):
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

    # Admin-only notification toggles. A non-admin echoing the existing value
    # back is fine (the frontend may include unchanged keys), but any actual
    # change must come from a project admin or server admin. Existing values
    # are preserved when the frontend omits the keys, so non-admins whose UI
    # hides these rows do not accidentally clear them.
    if data.notification_channels is not None:
        is_admin_user = await can_admin_project(current_user, project_id, db)
        if not is_admin_user:
            existing_channels = (prefs.notification_channels or {}) if prefs else {}
            for key in ADMIN_ONLY_NOTIFICATION_KEYS:
                incoming = data.notification_channels.get(key)
                existing = existing_channels.get(key)
                if incoming is not None and incoming != existing:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Only project admins can change the '{key}' notification toggle",
                    )
                if existing is not None:
                    data.notification_channels[key] = existing

        # Validate per-camera scope on species_detection. Cameras can only be
        # selected from this project, so a stale id or a cross-project id is
        # rejected loudly rather than silently broadening the rule engine.
        species_cfg = data.notification_channels.get("species_detection")
        if isinstance(species_cfg, dict):
            notify_cameras = species_cfg.get("notify_cameras")
            if isinstance(notify_cameras, list) and notify_cameras:
                if not all(isinstance(cid, int) for cid in notify_cameras):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="notify_cameras must contain camera ids as integers",
                    )
                project_camera_rows = await db.execute(
                    select(Camera.id).where(Camera.project_id == project_id)
                )
                project_camera_ids = {row[0] for row in project_camera_rows.all()}
                unknown = [cid for cid in notify_cameras if cid not in project_camera_ids]
                if unknown:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Cameras not in this project: {unknown}",
                    )

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


# Telegram Linking Endpoints

class TelegramLinkTokenResponse(BaseModel):
    """Response for generating Telegram linking token"""
    token: str
    deep_link: str
    expires_at: str  # ISO format datetime


class TelegramLinkStatusResponse(BaseModel):
    """Response for checking Telegram linking status"""
    linked: bool
    chat_id: Optional[str] = None


@router.post(
    "/{project_id}/telegram/generate-link-token",
    response_model=TelegramLinkTokenResponse,
)
async def generate_telegram_link_token(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Generate a secure token for automated Telegram account linking.

    Creates a temporary token that the user can use to link their Telegram
    account via a deep link. The token expires after 24 hours and can only
    be used once.

    Args:
        project_id: ID of the project
        db: Database session
        current_user: Current authenticated user

    Returns:
        Token and deep link URL for Telegram linking

    Raises:
        HTTPException 403: If user doesn't have access to this project
        HTTPException 404: If project doesn't exist
        HTTPException 503: If Telegram bot is not configured
    """
    import secrets
    from datetime import timedelta

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

    # Verify user has access (project member or server admin)
    if not await can_access_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project"
        )

    # Check if Telegram is configured
    from shared.models import TelegramConfig, TelegramLinkingToken
    telegram_config_result = await db.execute(
        select(TelegramConfig).where(TelegramConfig.is_configured == True).limit(1)
    )
    telegram_config = telegram_config_result.scalar_one_or_none()

    if not telegram_config or not telegram_config.bot_username:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram bot is not configured. Contact your administrator."
        )

    # Generate secure random token (32 bytes = 64 hex chars)
    token = secrets.token_hex(32)

    # Calculate expiration (24 hours from now)
    from datetime import datetime, timezone
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    # Create linking token record
    linking_token = TelegramLinkingToken(
        token=token,
        user_id=current_user.id,
        project_id=project_id,
        expires_at=expires_at,
        used=False
    )

    db.add(linking_token)
    await db.commit()

    # Generate deep link
    deep_link = f"https://t.me/{telegram_config.bot_username}?start={token}"

    return TelegramLinkTokenResponse(
        token=token,
        deep_link=deep_link,
        expires_at=expires_at.isoformat()
    )


@router.get(
    "/{project_id}/telegram/link-status",
    response_model=TelegramLinkStatusResponse,
)
async def get_telegram_link_status(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Check if user has linked their Telegram account for this project.

    Returns the current telegram_chat_id if set, indicating successful linking.

    Args:
        project_id: ID of the project
        db: Database session
        current_user: Current authenticated user

    Returns:
        Linking status and chat_id if linked

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

    # Verify user has access (project member or server admin)
    if not await can_access_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project"
        )

    # Get notification preferences
    result = await db.execute(
        select(ProjectNotificationPreference).where(
            and_(
                ProjectNotificationPreference.user_id == current_user.id,
                ProjectNotificationPreference.project_id == project_id
            )
        )
    )
    prefs = result.scalar_one_or_none()

    if prefs and prefs.telegram_chat_id:
        return TelegramLinkStatusResponse(
            linked=True,
            chat_id=prefs.telegram_chat_id
        )

    return TelegramLinkStatusResponse(
        linked=False,
        chat_id=None
    )


@router.delete(
    "/{project_id}/telegram/unlink",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unlink_telegram(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Unlink Telegram account by removing chat_id from notification preferences.

    This will remove the telegram_chat_id from the user's notification preferences,
    effectively unlinking their Telegram account. They will need to link again
    to receive notifications.

    Args:
        project_id: ID of the project
        db: Database session
        current_user: Current authenticated user

    Raises:
        HTTPException 403: If user doesn't have access to this project
        HTTPException 404: If project doesn't exist or no preferences found
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

    # Verify user has access (project member or server admin)
    if not await can_access_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this project"
        )

    # Get notification preferences
    result = await db.execute(
        select(ProjectNotificationPreference).where(
            and_(
                ProjectNotificationPreference.user_id == current_user.id,
                ProjectNotificationPreference.project_id == project_id
            )
        )
    )
    prefs = result.scalar_one_or_none()

    # If no preferences exist, there's nothing to unlink - return success
    if not prefs:
        return

    # Remove telegram_chat_id if it exists
    if prefs.telegram_chat_id:
        prefs.telegram_chat_id = None
        await db.commit()

    # Return 204 No Content (no body)
