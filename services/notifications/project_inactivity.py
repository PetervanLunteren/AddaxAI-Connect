"""
Project inactivity alert — daily check.

Sends an email to opted-in project admins when an entire project receives
zero images in the last 48 hours. This usually means something is wrong
with the FTPS server, network, or all cameras at once.
"""
from typing import Dict, Any, Optional
from datetime import datetime, timedelta, timezone

from sqlalchemy import text, select

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    ProjectNotificationPreference,
    User,
    Project
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import create_notification_log, get_server_timezone

logger = get_logger("notifications.project_inactivity")
settings = get_settings()


def send_project_inactivity_alerts() -> None:
    """
    Scheduled job: check whether each project received at least one image
    in the last 48 hours. Email opted-in project admins if not.
    """
    logger.info("Starting project inactivity alert check")

    with get_sync_session() as db:
        tz = get_server_timezone(db)

        # captured_at is naive in server tz; use naive local-now as the reference.
        now = datetime.now(tz).replace(tzinfo=None)
        window_start = now - timedelta(hours=48)
        window_end = now

        # Query all notification preferences joined with user and project
        query = (
            select(ProjectNotificationPreference, User, Project)
            .join(User, ProjectNotificationPreference.user_id == User.id)
            .join(Project, ProjectNotificationPreference.project_id == Project.id)
            .where(
                User.is_active == True,
                User.is_verified == True
            )
        )

        preferences = list(db.execute(query).all())

        if not preferences:
            logger.info("No users with notification preferences found")
            return

        # Filter to users with project_inactivity alerts enabled
        eligible = []
        for pref, user, project in preferences:
            config = _get_project_inactivity_config(pref)
            if config:
                eligible.append((pref, user, project))

        if not eligible:
            logger.info("No users with project inactivity alerts enabled")
            return

        logger.info(
            "Processing project inactivity alerts",
            user_project_count=len(eligible),
            window_start=window_start.isoformat()
        )

        # Cache project image counts to avoid duplicate queries
        project_has_images: Dict[int, bool] = {}

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        messages_queued = 0

        for pref, user, project in eligible:
            try:
                to_email = user.email

                if not to_email:
                    logger.warning(
                        "No email address for user",
                        user_id=user.id,
                        project_id=project.id
                    )
                    continue

                # Check if project had any images (cached per project)
                if project.id not in project_has_images:
                    project_has_images[project.id] = _project_received_images(
                        db, project.id, window_start, window_end
                    )

                if project_has_images[project.id]:
                    continue

                domain = settings.domain_name or "localhost:3000"
                dashboard_url = f"https://{domain}/projects/{project.id}/dashboard"
                settings_url = f"https://{domain}/projects/{project.id}/notifications"

                template_data = {
                    'project_name': project.name,
                    'date_label': now.strftime('%B %d, %Y'),
                    'dashboard_url': dashboard_url,
                    'settings_url': settings_url,
                }

                html_content, _ = render_email(
                    'project_inactivity_alert.html', **template_data
                )
                text_content = _generate_text_content(
                    project.name, dashboard_url, settings_url
                )

                subject = f"{project.name} - No images received in 48 hours"

                trigger_data = {
                    'project_id': project.id,
                    'project_name': project.name,
                    'checked_at': now.isoformat(),
                    'generated_at': datetime.now(timezone.utc).isoformat()
                }

                log_id = create_notification_log(
                    user_id=user.id,
                    notification_type='project_inactivity',
                    channel='email',
                    trigger_data=trigger_data,
                    message_content=text_content[:1000]
                )

                email_queue.publish({
                    'notification_log_id': log_id,
                    'to_email': to_email,
                    'subject': subject,
                    'body_text': text_content,
                    'body_html': html_content
                })

                messages_queued += 1

                logger.info(
                    "Queued project inactivity alert",
                    user_id=user.id,
                    user_email=to_email,
                    project_id=project.id,
                    log_id=log_id
                )

            except Exception as e:
                logger.error(
                    "Failed to process project inactivity alert for user",
                    user_id=user.id,
                    project_id=project.id,
                    error=str(e),
                    exc_info=True
                )
                continue

        logger.info(
            "Project inactivity alerts completed",
            total_checked=len(eligible),
            messages_queued=messages_queued
        )


def _get_project_inactivity_config(pref: ProjectNotificationPreference) -> Optional[Dict[str, Any]]:
    """Extract project_inactivity config from notification_channels JSON."""
    channels_config = pref.notification_channels

    if not channels_config or not isinstance(channels_config, dict):
        return None

    config = channels_config.get('project_inactivity', {})

    if not isinstance(config, dict):
        return None

    if not config.get('enabled', False):
        return None

    return config


def _project_received_images(
    db, project_id: int, window_start: datetime, window_end: datetime
) -> bool:
    """Check whether a project received at least one image in the given window."""
    result = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM images i
                JOIN cameras c ON i.camera_id = c.id
                WHERE c.project_id = :project_id
                  AND i.captured_at >= :window_start
                  AND i.captured_at < :window_end
            )
        """),
        {
            'project_id': project_id,
            'window_start': window_start,
            'window_end': window_end
        }
    )
    return result.scalar()


def _generate_text_content(
    project_name: str,
    dashboard_url: str,
    settings_url: str
) -> str:
    """Generate plain text version of the project inactivity alert."""
    lines = [
        f"{project_name} - No images received in 48 hours",
        "=" * 50,
        "",
        f"The project \"{project_name}\" did not receive any images in the last 48 hours.",
        "",
        "This may indicate a problem with the FTPS server, network connectivity,",
        "or all cameras in this project.",
        "",
        "-" * 50,
        f"View dashboard: {dashboard_url}",
        f"Manage notifications: {settings_url}",
        "",
        "AddaxAI Connect - Camera trap image processing"
    ]

    return "\n".join(lines)
