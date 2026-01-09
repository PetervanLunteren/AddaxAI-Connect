"""
Daily battery digest notifications

Sends consolidated daily battery alerts at noon UTC.
Each user receives one message per project with count of cameras below threshold.
"""
from typing import List, Dict, Any
from datetime import datetime
from sqlalchemy import select, and_, func
from sqlalchemy.orm import Session

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    ProjectNotificationPreference,
    User,
    Project,
    Camera
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_SIGNAL
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
    - Send one message per project with cameras below threshold
    """
    logger.info("Starting daily battery digest")

    with get_sync_session() as db:
        # Get all users with battery notifications enabled
        query = (
            select(ProjectNotificationPreference, User, Project)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .join(Project, ProjectNotificationPreference.project_id == Project.id)
            .where(
                ProjectNotificationPreference.enabled == True,
                ProjectNotificationPreference.notify_low_battery == True,
                ProjectNotificationPreference.signal_phone.isnot(None),
                User.is_active == True,
                User.is_verified == True,
            )
        )

        preferences = list(db.execute(query).all())

        if not preferences:
            logger.info("No users with battery notifications enabled")
            return

        logger.info(
            "Processing battery digest",
            user_project_count=len(preferences)
        )

        signal_queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)
        messages_sent = 0

        for pref, user, project in preferences:
            try:
                # Count cameras below threshold for this project
                camera_count_query = (
                    select(func.count(Camera.id))
                    .where(
                        and_(
                            Camera.project_id == project.id,
                            Camera.battery_percent.isnot(None),
                            Camera.battery_percent <= pref.battery_threshold
                        )
                    )
                )

                low_battery_count = db.execute(camera_count_query).scalar()

                if low_battery_count == 0:
                    logger.debug(
                        "No cameras below threshold",
                        user_id=user.id,
                        project_id=project.id,
                        threshold=pref.battery_threshold
                    )
                    continue

                # Build message
                domain = settings.domain_name or "localhost:3000"
                project_url = f"https://{domain}/projects/{project.id}/cameras"

                message_lines = [
                    f"Battery Alert for Project \"{project.name}\"",
                    "",
                    f"{low_battery_count} {'camera is' if low_battery_count == 1 else 'cameras are'} below your {pref.battery_threshold}% battery threshold",
                    "",
                    f"View details: {project_url}"
                ]

                message_content = "\n".join(message_lines)

                # Create notification log entry
                log_id = create_notification_log(
                    user_id=user.id,
                    notification_type='battery_digest',
                    channel='signal',
                    trigger_data={
                        'project_id': project.id,
                        'project_name': project.name,
                        'camera_count': low_battery_count,
                        'threshold': pref.battery_threshold,
                        'digest_date': datetime.utcnow().isoformat()
                    },
                    message_content=message_content
                )

                # Publish to Signal queue
                signal_queue.publish({
                    'notification_log_id': log_id,
                    'recipient_phone': pref.signal_phone,
                    'message_text': message_content,
                    'attachment_path': None,  # No attachment for digest
                })

                messages_sent += 1

                logger.info(
                    "Queued battery digest",
                    user_id=user.id,
                    user_email=user.email,
                    project_id=project.id,
                    project_name=project.name,
                    camera_count=low_battery_count,
                    threshold=pref.battery_threshold,
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
