"""
User notification preferences endpoints.

Authenticated users can manage their own notification settings.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, NotificationPreference
from shared.database import get_async_session
from auth.users import current_active_user


router = APIRouter(prefix="/api/users/me", tags=["notifications"])


class NotificationPreferenceResponse(BaseModel):
    """Response for notification preferences"""
    enabled: bool
    signal_phone: Optional[str]
    notify_species: Optional[List[str]]
    notify_low_battery: bool
    battery_threshold: int
    notify_system_health: bool

    class Config:
        from_attributes = True


class NotificationPreferenceUpdateRequest(BaseModel):
    """Request to update notification preferences"""
    enabled: Optional[bool] = None
    signal_phone: Optional[str] = None  # E.164 format
    notify_species: Optional[List[str]] = None  # List of species IDs/names, None = all
    notify_low_battery: Optional[bool] = None
    battery_threshold: Optional[int] = None  # 0-100
    notify_system_health: Optional[bool] = None


@router.get(
    "/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def get_notification_preferences(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get current user's notification preferences.

    Returns the authenticated user's notification settings.
    If preferences don't exist yet, returns defaults.

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        User's notification preferences
    """
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id
        )
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # Return default preferences if none exist
        return NotificationPreferenceResponse(
            enabled=False,
            signal_phone=None,
            notify_species=None,
            notify_low_battery=True,
            battery_threshold=30,
            notify_system_health=False,
        )

    return prefs


@router.put(
    "/notification-preferences",
    response_model=NotificationPreferenceResponse,
)
async def update_notification_preferences(
    data: NotificationPreferenceUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Update current user's notification preferences.

    Creates or updates the authenticated user's notification settings.
    Only provided fields will be updated.

    Args:
        data: Notification preference updates
        db: Database session
        current_user: Current authenticated user

    Returns:
        Updated notification preferences

    Raises:
        HTTPException 400: If validation fails (e.g., invalid battery threshold)
    """
    # Validate battery threshold if provided
    if data.battery_threshold is not None:
        if not 0 <= data.battery_threshold <= 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Battery threshold must be between 0 and 100"
            )

    # Get or create preferences
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id
        )
    )
    prefs = result.scalar_one_or_none()

    if not prefs:
        # Create new preferences with defaults
        prefs = NotificationPreference(
            user_id=current_user.id,
            enabled=False,
            signal_phone=None,
            notify_species=None,
            notify_low_battery=True,
            battery_threshold=30,
            notify_system_health=False,
        )
        db.add(prefs)

    # Update provided fields
    if data.enabled is not None:
        prefs.enabled = data.enabled
    if data.signal_phone is not None:
        prefs.signal_phone = data.signal_phone
    if data.notify_species is not None:
        prefs.notify_species = data.notify_species
    if data.notify_low_battery is not None:
        prefs.notify_low_battery = data.notify_low_battery
    if data.battery_threshold is not None:
        prefs.battery_threshold = data.battery_threshold
    if data.notify_system_health is not None:
        prefs.notify_system_health = data.notify_system_health

    await db.commit()
    await db.refresh(prefs)

    return prefs
