"""
Database operations for notifications service
"""
from typing import Dict, Any, Optional
from datetime import datetime

from shared.logger import get_logger
from shared.models import NotificationLog
from shared.database import get_sync_session

logger = get_logger("notifications.db")


def create_notification_log(
    user_id: int,
    notification_type: str,
    channel: str,
    trigger_data: Dict[str, Any],
    message_content: str
) -> int:
    """
    Create notification log entry with status='pending'.

    Args:
        user_id: User ID
        notification_type: Type of notification (species_detection, low_battery, system_health)
        channel: Notification channel (signal, email, sms, earthranger)
        trigger_data: Event data that triggered the notification
        message_content: Formatted message text

    Returns:
        Notification log ID
    """
    with get_sync_session() as session:
        log = NotificationLog(
            user_id=user_id,
            notification_type=notification_type,
            channel=channel,
            status='pending',
            trigger_data=trigger_data,
            message_content=message_content,
        )

        session.add(log)
        session.commit()
        session.refresh(log)

        logger.debug(
            "Created notification log",
            log_id=log.id,
            user_id=user_id,
            notification_type=notification_type,
            channel=channel
        )

        return log.id


def update_notification_status(
    log_id: int,
    status: str,
    error_message: Optional[str] = None
) -> None:
    """
    Update notification log status.

    Args:
        log_id: Notification log ID
        status: New status ('sent', 'failed')
        error_message: Error message if status is 'failed'
    """
    with get_sync_session() as session:
        log = session.get(NotificationLog, log_id)

        if not log:
            logger.error("Notification log not found", log_id=log_id)
            return

        log.status = status

        if status == 'sent':
            log.sent_at = datetime.utcnow()
        elif status == 'failed':
            log.error_message = error_message

        session.commit()

        logger.info(
            "Updated notification status",
            log_id=log_id,
            status=status,
            has_error=error_message is not None
        )
