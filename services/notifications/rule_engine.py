"""
Notification rule engine

Evaluates which users should be notified for a given event.
"""
from typing import Dict, Any, List
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared.logger import get_logger
from shared.models import NotificationPreference, User
from shared.database import get_sync_session

logger = get_logger("notifications.rules")


def get_matching_users(event: Dict[str, Any]) -> List[NotificationPreference]:
    """
    Get list of users who should be notified for this event.

    Args:
        event: Notification event

    Returns:
        List of NotificationPreference objects for users who match criteria

    Rules (MVP - simple toggles):
    - Species detection: user.notify_species is None (all) or contains species
    - Low battery: user.notify_low_battery is True and battery <= threshold
    - System health: user.notify_system_health is True (admins only)

    All rules also check:
    - User has notifications enabled
    - User has Signal phone number configured
    - User is active and verified
    """
    event_type = event.get('event_type')

    if not event_type:
        logger.error("Missing event type in get_matching_users")
        return []

    matching_users: List[NotificationPreference] = []

    with get_sync_session() as session:
        # Base query: enabled notifications, has phone number, user is active and verified
        query = (
            select(NotificationPreference)
            .join(User, NotificationPreference.user_id == User.id)
            .where(
                NotificationPreference.enabled == True,
                NotificationPreference.signal_phone.isnot(None),
                User.is_active == True,
                User.is_verified == True,
            )
        )

        # Add event-specific filters
        if event_type == 'species_detection':
            species = event.get('species')
            if not species:
                logger.error("Missing species in species_detection event")
                return []

            # User wants this species: notify_species is null (all) OR species in list
            # Note: In SQL, we need to handle null separately and use JSON contains
            query = query.where(
                (NotificationPreference.notify_species.is_(None)) |
                (NotificationPreference.notify_species.contains([species]))
            )

        elif event_type == 'low_battery':
            battery_percentage = event.get('battery_percentage')
            if battery_percentage is None:
                logger.error("Missing battery_percentage in low_battery event")
                return []

            # User wants battery notifications AND battery is below their threshold
            query = query.where(
                NotificationPreference.notify_low_battery == True,
                NotificationPreference.battery_threshold >= battery_percentage
            )

        elif event_type == 'system_health':
            # Only users who opted in for system health notifications
            query = query.where(
                NotificationPreference.notify_system_health == True
            )

        else:
            logger.error("Unknown event type", event_type=event_type)
            return []

        # Execute query
        matching_users = list(session.execute(query).scalars().all())

    logger.info(
        "Evaluated notification rules",
        event_type=event_type,
        matching_count=len(matching_users)
    )

    return matching_users
