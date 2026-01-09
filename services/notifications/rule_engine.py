"""
Notification rule engine

Evaluates which users should be notified for a given event.
"""
from typing import Dict, Any, List
from sqlalchemy import select, cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from shared.logger import get_logger
from shared.models import ProjectNotificationPreference, User, Project
from shared.database import get_sync_session

logger = get_logger("notifications.rules")


def get_matching_users(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Get list of users who should be notified for this event.

    Args:
        event: Notification event

    Returns:
        List of dictionaries with user_id and signal_phone for users who match criteria

    Rules (MVP - simple toggles):
    - Species detection: user.notify_species is None (all) or contains species
    - Low battery: user.notify_low_battery is True and battery <= threshold (DEPRECATED - now handled by battery_digest.py)
    - System health: user.notify_system_health is True (admins only)

    All rules also check:
    - User has notifications enabled for the project
    - User has Signal phone number configured
    - User is active and verified
    """
    event_type = event.get('event_type')
    project_id = event.get('project_id')  # Required for project-based notifications

    if not event_type:
        logger.error("Missing event type in get_matching_users")
        return []

    if not project_id:
        logger.error("Missing project_id in event", event_type=event_type)
        return []

    matching_users: List[ProjectNotificationPreference] = []

    with get_sync_session() as session:
        # Base query: enabled notifications, has phone number, user is active and verified
        query = (
            select(ProjectNotificationPreference)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .where(
                ProjectNotificationPreference.project_id == project_id,
                ProjectNotificationPreference.enabled == True,
                ProjectNotificationPreference.signal_phone.isnot(None),
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
            # Use PostgreSQL @> operator to check if JSONB array contains species
            query = query.where(
                (ProjectNotificationPreference.notify_species.is_(None)) |
                (ProjectNotificationPreference.notify_species.op('@>')(cast([species], JSONB)))
            )

        elif event_type == 'low_battery':
            # DEPRECATED: Battery notifications now handled by daily digest (battery_digest.py)
            # Kept for backwards compatibility but will return empty list
            logger.info("Ignoring low_battery event - handled by daily digest")
            return []

        elif event_type == 'system_health':
            # Only users who opted in for system health notifications
            query = query.where(
                ProjectNotificationPreference.notify_system_health == True
            )

        else:
            logger.error("Unknown event type", event_type=event_type)
            return []

        # Execute query and convert to dictionaries
        preferences = list(session.execute(query).scalars().all())
        matching_users = [
            {
                'user_id': pref.user_id,
                'signal_phone': pref.signal_phone
            }
            for pref in preferences
        ]

    logger.info(
        "Evaluated notification rules",
        event_type=event_type,
        matching_count=len(matching_users)
    )

    return matching_users
