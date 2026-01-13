"""
Daily battery digest notifications

Sends consolidated daily battery alerts at noon UTC.
Each user receives one message per project with count of cameras below threshold.
Supports multi-channel delivery (Signal, Telegram, etc.)
"""
from typing import List, Dict, Any
from datetime import datetime
from sqlalchemy import select, and_, func, or_
from sqlalchemy.orm import Session

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    ProjectNotificationPreference,
    User,
    Project,
    Camera
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_SIGNAL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings

from db_operations import create_notification_log

logger = get_logger("notifications.battery_digest")
settings = get_settings()


def send_daily_battery_digest() -> None:
    """
    Send daily battery digest at noon UTC.

    For each user with battery notifications enabled:
    - Group by projects they have access to
    - Count cameras below their threshold
    - Send one message per project per channel with cameras below threshold

    Uses notification_channels JSON configuration to determine which channels to use.
    Falls back to legacy fields if notification_channels is None.
    """
    logger.info("Starting daily battery digest")

    with get_sync_session() as db:
        # Get all users with any channel configured (Signal OR Telegram)
        query = (
            select(ProjectNotificationPreference, User, Project)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .join(Project, ProjectNotificationPreference.project_id == Project.id)
            .where(
                User.is_active == True,
                User.is_verified == True,
                or_(
                    ProjectNotificationPreference.signal_phone.isnot(None),
                    ProjectNotificationPreference.telegram_chat_id.isnot(None)
                )
            )
        )

        preferences = list(db.execute(query).all())

        if not preferences:
            logger.info("No users with notification channels configured")
            return

        logger.info(
            "Processing battery digest",
            user_project_count=len(preferences)
        )

        # Initialize queues
        signal_queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)
        telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
        messages_sent = 0

        for pref, user, project in preferences:
            try:
                # Determine which channels to use and if battery digest is enabled
                channels = _get_battery_digest_channels(pref)

                if not channels:
                    logger.debug(
                        "Battery digest not enabled for user",
                        user_id=user.id,
                        project_id=project.id
                    )
                    continue

                # Get battery threshold from JSON config or legacy field
                battery_threshold = _get_battery_threshold(pref)

                # Count cameras below threshold for this project
                camera_count_query = (
                    select(func.count(Camera.id))
                    .where(
                        and_(
                            Camera.project_id == project.id,
                            Camera.battery_percent.isnot(None),
                            Camera.battery_percent <= battery_threshold
                        )
                    )
                )

                low_battery_count = db.execute(camera_count_query).scalar()

                if low_battery_count == 0:
                    logger.debug(
                        "No cameras below threshold",
                        user_id=user.id,
                        project_id=project.id,
                        threshold=battery_threshold
                    )
                    continue

                # Build message
                domain = settings.domain_name or "localhost:3000"
                project_url = f"https://{domain}/projects/{project.id}/cameras"

                message_lines = [
                    f"*Battery alert for project \"{project.name}\"*",
                    "",
                    f"{low_battery_count} {'camera is' if low_battery_count == 1 else 'cameras are'} below your {battery_threshold}% battery threshold"
                ]

                message_content = "\n".join(message_lines)

                trigger_data = {
                    'project_id': project.id,
                    'project_name': project.name,
                    'camera_count': low_battery_count,
                    'threshold': battery_threshold,
                    'digest_date': datetime.utcnow().isoformat()
                }

                # Send via all configured channels
                for channel in channels:
                    if channel == 'signal' and pref.signal_phone:
                        # Signal doesn't support buttons, include URL in message
                        signal_message = message_content + f"\n\nView details: {project_url}"

                        # Create notification log entry
                        log_id = create_notification_log(
                            user_id=user.id,
                            notification_type='battery_digest',
                            channel='signal',
                            trigger_data=trigger_data,
                            message_content=signal_message
                        )

                        # Publish to Signal queue
                        signal_queue.publish({
                            'notification_log_id': log_id,
                            'recipient_phone': pref.signal_phone,
                            'message_text': signal_message,
                            'attachment_path': None,
                        })

                        messages_sent += 1

                        logger.info(
                            "Queued battery digest",
                            user_id=user.id,
                            user_email=user.email,
                            project_id=project.id,
                            project_name=project.name,
                            camera_count=low_battery_count,
                            threshold=battery_threshold,
                            channel='signal',
                            log_id=log_id
                        )

                    elif channel == 'telegram' and pref.telegram_chat_id:
                        # Telegram supports inline buttons
                        inline_keyboard = {
                            'inline_keyboard': [[
                                {
                                    'text': 'View details',
                                    'url': project_url
                                }
                            ]]
                        }

                        # Create notification log entry
                        log_id = create_notification_log(
                            user_id=user.id,
                            notification_type='battery_digest',
                            channel='telegram',
                            trigger_data=trigger_data,
                            message_content=message_content
                        )

                        # Publish to Telegram queue
                        telegram_queue.publish({
                            'notification_log_id': log_id,
                            'chat_id': pref.telegram_chat_id,
                            'message_text': message_content,
                            'attachment_path': None,
                            'reply_markup': inline_keyboard
                        })

                        messages_sent += 1

                        logger.info(
                            "Queued battery digest",
                            user_id=user.id,
                            user_email=user.email,
                            project_id=project.id,
                            project_name=project.name,
                            camera_count=low_battery_count,
                            threshold=battery_threshold,
                            channel='telegram',
                            log_id=log_id
                        )

            except Exception as e:
                logger.error(
                    "Failed to process battery digest for user",
                    user_id=user.id,
                    project_id=project.id,
                    error=str(e),
                    exc_info=True
                )
                # Continue with next user/project
                continue

        logger.info(
            "Daily battery digest completed",
            total_checked=len(preferences),
            messages_sent=messages_sent
        )


def _get_battery_digest_channels(pref: ProjectNotificationPreference) -> List[str]:
    """
    Get list of channels to use for battery digest.

    Uses notification_channels JSON if present, otherwise falls back to legacy fields.

    Returns:
        List of channel names (e.g., ['signal', 'telegram'])
    """
    channels_config = pref.notification_channels

    # Use JSON configuration if present
    if channels_config and isinstance(channels_config, dict):
        battery_config = channels_config.get('battery_digest', {})

        if not isinstance(battery_config, dict):
            return []

        # Check if enabled
        if not battery_config.get('enabled', False):
            return []

        # Get list of channels
        channels = battery_config.get('channels', [])
        if not isinstance(channels, list):
            return []

        # Validate channels against available contact info
        valid_channels = []
        if 'signal' in channels and pref.signal_phone:
            valid_channels.append('signal')
        if 'telegram' in channels and pref.telegram_chat_id:
            valid_channels.append('telegram')

        return valid_channels

    # Fall back to legacy fields
    if pref.enabled and pref.notify_low_battery:
        if pref.signal_phone:
            return ['signal']

    return []


def _get_battery_threshold(pref: ProjectNotificationPreference) -> int:
    """
    Get battery threshold from JSON config or legacy field.

    Returns:
        Battery threshold percentage (0-100)
    """
    channels_config = pref.notification_channels

    # Try JSON configuration first
    if channels_config and isinstance(channels_config, dict):
        battery_config = channels_config.get('battery_digest', {})
        if isinstance(battery_config, dict):
            threshold = battery_config.get('battery_threshold')
            if isinstance(threshold, int) and 0 <= threshold <= 100:
                return threshold

    # Fall back to legacy field
    return pref.battery_threshold if pref.battery_threshold is not None else 30
