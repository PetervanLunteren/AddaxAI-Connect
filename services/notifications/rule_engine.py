"""
Notification rule engine

Evaluates which users should be notified for a given event, and through which channels.
"""
from typing import Dict, Any, List
from sqlalchemy import select, cast, or_
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from shared.logger import get_logger
from shared.models import ProjectNotificationPreference, User, Project
from shared.database import get_sync_session

logger = get_logger("notifications.rules")


def get_matching_users(event: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Get list of users who should be notified for this event, with their channel preferences.

    Args:
        event: Notification event

    Returns:
        List of dictionaries with user_id, telegram_chat_id, and channels array
        Example:
        [
            {
                'user_id': 5,
                'telegram_chat_id': '987654321',
                'channels': ['telegram']
            }
        ]

    Rules:
    - Uses notification_channels JSON field for per-type channel selection
    - Legacy fields no longer supported (only Telegram)
    - Species detection: checks notify_species list in JSON
    - Battery digest: separate handler (battery_digest.py)
    - System health: checks enabled flag in JSON

    All rules also check:
    - User has Telegram configured (telegram_chat_id)
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

    with get_sync_session() as session:
        # Base query: user is active and verified, has Telegram configured
        query = (
            select(ProjectNotificationPreference)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .where(
                ProjectNotificationPreference.project_id == project_id,
                User.is_active == True,
                User.is_verified == True,
                ProjectNotificationPreference.telegram_chat_id.isnot(None)
            )
        )

        # Execute query to get all preferences for this project
        preferences = list(session.execute(query).scalars().all())

        # Filter in Python based on notification_channels JSON
        matching_users = []

        for pref in preferences:
            # Parse notification_channels JSON
            channels_config = pref.notification_channels

            # If notification_channels is None, fall back to legacy fields
            if channels_config is None:
                result = _evaluate_legacy_preferences(pref, event_type, event)
                if result:
                    matching_users.append(result)
                continue

            # Use JSON configuration
            result = _evaluate_json_preferences(pref, event_type, event, channels_config)
            if result:
                matching_users.append(result)

    logger.info(
        "Evaluated notification rules",
        event_type=event_type,
        matching_count=len(matching_users)
    )

    return matching_users


def _evaluate_legacy_preferences(
    pref: ProjectNotificationPreference,
    event_type: str,
    event: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Evaluate using legacy boolean fields (backward compatibility)

    Returns user dict if matches, None otherwise

    Legacy preferences only supported Signal, which is no longer available.
    This function now returns None for all cases.
    """
    # Legacy fields only supported Signal, no longer available
    return None


def _evaluate_json_preferences(
    pref: ProjectNotificationPreference,
    event_type: str,
    event: Dict[str, Any],
    channels_config: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Evaluate using notification_channels JSON configuration

    Returns user dict if matches, None otherwise
    """
    # Get config for this notification type
    type_config = channels_config.get(event_type, {})

    if not isinstance(type_config, dict):
        return None

    # Check if enabled for this type
    if not type_config.get('enabled', False):
        return None

    # Get list of channels for this type
    channels = type_config.get('channels', [])
    if not channels or not isinstance(channels, list):
        return None

    # Validate channels against available contact info
    valid_channels = []
    if 'telegram' in channels and pref.telegram_chat_id:
        valid_channels.append('telegram')

    if not valid_channels:
        return None

    # Event-specific validation
    if event_type == 'species_detection':
        species = event.get('species')
        if not species:
            return None

        # Check notify_species: null = all, or list contains species
        notify_species = type_config.get('notify_species')
        if notify_species is not None and species not in notify_species:
            return None

    elif event_type == 'battery_digest':
        # Battery threshold is stored in type config
        # Threshold checking happens in battery_digest.py, not here
        pass

    elif event_type == 'system_health':
        # Just needs to be enabled (already checked above)
        pass

    else:
        logger.warning("Unknown event type", event_type=event_type)
        return None

    return {
        'user_id': pref.user_id,
        'telegram_chat_id': pref.telegram_chat_id,
        'channels': valid_channels
    }
