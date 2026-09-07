"""
Database operations for the Sensing Clues notifications worker.

The notification log row records the outcome of one observation; the
project's integration row records the state of the connection as a whole,
which is what the integration page shows.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from shared.database import get_sync_session
from shared.logger import get_logger
from shared.models import NotificationLog, ProjectIntegration

logger = get_logger("notifications-sensingclues.db")

KIND = "sensingclues"


def _integration(session, project_id: int) -> Optional[ProjectIntegration]:
    return session.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == KIND,
        )
    ).scalar_one_or_none()


def load_group_id(project_id: int) -> Optional[int]:
    """The project's Cluey group id, or None when the integration is
    missing, disabled, or has no group id."""
    with get_sync_session() as session:
        integration = _integration(session, project_id)
        if not integration or not integration.is_enabled:
            return None
        return (integration.config or {}).get("group_id") or None


def record_success(project_id: int) -> None:
    with get_sync_session() as session:
        integration = _integration(session, project_id)
        if not integration:
            return
        integration.last_sent_at = datetime.now(timezone.utc)
        integration.events_sent = (integration.events_sent or 0) + 1
        integration.last_error = None
        integration.health_status = "healthy"
        integration.last_health_check = integration.last_sent_at
        session.commit()


def record_failure(project_id: int, error: str) -> None:
    with get_sync_session() as session:
        integration = _integration(session, project_id)
        if not integration:
            return
        integration.last_error = error[:1000]
        integration.health_status = "error"
        integration.last_health_check = datetime.now(timezone.utc)
        session.commit()


def update_notification_status(
    log_id: int,
    status: str,
    error_message: Optional[str] = None,
) -> None:
    """Same contract as the email, Telegram and EarthRanger workers:
    'sent' stamps sent_at, 'failed' and 'blocked' keep their reason."""
    with get_sync_session() as session:
        log = session.get(NotificationLog, log_id)
        if not log:
            logger.error("Notification log not found", log_id=log_id)
            return
        log.status = status
        if status == 'sent':
            log.sent_at = datetime.now(timezone.utc)
        elif error_message is not None:
            log.error_message = error_message
        session.commit()
        logger.info(
            "Updated notification status",
            log_id=log_id,
            status=status,
            has_error=error_message is not None,
        )
