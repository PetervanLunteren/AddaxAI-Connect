"""
Database operations for email notifications worker.

Handles notification log status updates.
"""
from typing import Optional
from datetime import datetime, timezone

from shared.logger import get_logger
from shared.models import NotificationLog
from shared.database import get_sync_session

logger = get_logger("notifications-email.db")


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
            log.sent_at = datetime.now(timezone.utc)
        elif status == 'failed':
            log.error_message = error_message

        session.commit()

        logger.info(
            "Updated notification status",
            log_id=log_id,
            status=status,
            has_error=error_message is not None
        )
