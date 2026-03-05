"""
Excessive image alert — daily digest email.

Cameras pointed at waving grass or direct sunlight trigger excessively,
sending dozens of images per day. This module sends a daily email listing
cameras that exceeded a configurable image threshold (default 50).
"""
from typing import List, Dict, Any, Optional
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text, select, and_

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

from db_operations import create_notification_log

logger = get_logger("notifications.excessive_images")
settings = get_settings()

DEFAULT_THRESHOLD = 50


def send_excessive_image_alerts() -> None:
    """
    Scheduled job: Check yesterday's image counts per camera and email
    users whose cameras exceeded their configured threshold.
    """
    logger.info("Starting excessive image alert check")

    yesterday = date.today() - timedelta(days=1)
    start_of_day = datetime(yesterday.year, yesterday.month, yesterday.day, tzinfo=timezone.utc)
    end_of_day = start_of_day + timedelta(days=1)

    with get_sync_session() as db:
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

        # Filter to users with excessive_images alerts enabled
        eligible = []
        for pref, user, project in preferences:
            config = _get_excessive_images_config(pref)
            if config:
                eligible.append((pref, user, project, config))

        if not eligible:
            logger.info("No users with excessive image alerts enabled")
            return

        logger.info(
            "Processing excessive image alerts",
            user_project_count=len(eligible),
            date=yesterday.isoformat()
        )

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        messages_queued = 0

        for pref, user, project, config in eligible:
            try:
                threshold = config.get('threshold', DEFAULT_THRESHOLD)
                to_email = pref.report_email if pref.report_email else user.email

                if not to_email:
                    logger.warning(
                        "No email address for user",
                        user_id=user.id,
                        project_id=project.id
                    )
                    continue

                # Find cameras exceeding the threshold
                cameras = _get_cameras_over_threshold(
                    db, project.id, start_of_day, end_of_day, threshold
                )

                if not cameras:
                    continue

                domain = settings.domain_name or "localhost:3000"
                images_url = f"https://{domain}/projects/{project.id}/images"
                settings_url = f"https://{domain}/projects/{project.id}/notifications"

                template_data = {
                    'project_name': project.name,
                    'date_label': yesterday.strftime('%B %d, %Y'),
                    'camera_count': len(cameras),
                    'threshold': threshold,
                    'cameras': cameras,
                    'images_url': images_url,
                    'settings_url': settings_url,
                }

                html_content, _ = render_email(
                    'excessive_images_alert.html', **template_data
                )
                text_content = _generate_text_content(
                    project.name, yesterday, threshold, cameras, images_url, settings_url
                )

                subject = f"{project.name} - Excessive image alert ({yesterday.strftime('%B %d, %Y')})"

                trigger_data = {
                    'project_id': project.id,
                    'project_name': project.name,
                    'date': yesterday.isoformat(),
                    'threshold': threshold,
                    'cameras_flagged': len(cameras),
                    'generated_at': datetime.now(timezone.utc).isoformat()
                }

                log_id = create_notification_log(
                    user_id=user.id,
                    notification_type='excessive_images',
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
                    "Queued excessive image alert",
                    user_id=user.id,
                    user_email=to_email,
                    project_id=project.id,
                    cameras_flagged=len(cameras),
                    log_id=log_id
                )

            except Exception as e:
                logger.error(
                    "Failed to process excessive image alert for user",
                    user_id=user.id,
                    project_id=project.id,
                    error=str(e),
                    exc_info=True
                )
                continue

        logger.info(
            "Excessive image alerts completed",
            total_checked=len(eligible),
            messages_queued=messages_queued
        )


def _get_excessive_images_config(pref: ProjectNotificationPreference) -> Optional[Dict[str, Any]]:
    """Extract excessive_images config from notification_channels JSON."""
    channels_config = pref.notification_channels

    if not channels_config or not isinstance(channels_config, dict):
        return None

    config = channels_config.get('excessive_images', {})

    if not isinstance(config, dict):
        return None

    if not config.get('enabled', False):
        return None

    return config


def _get_cameras_over_threshold(
    db, project_id: int, start_of_day: datetime, end_of_day: datetime, threshold: int
) -> List[Dict[str, Any]]:
    """
    Query cameras that received more than `threshold` images yesterday.

    Returns list of dicts with camera details and image count.
    """
    result = db.execute(
        text("""
            SELECT c.id, c.name, c.imei, c.notes, COUNT(*) as image_count,
                   (c.config->'gps_from_report'->>'lat')::float as lat,
                   (c.config->'gps_from_report'->>'lon')::float as lon
            FROM images i
            JOIN cameras c ON i.camera_id = c.id
            WHERE c.project_id = :project_id
              AND i.uploaded_at >= :start_of_day
              AND i.uploaded_at < :end_of_day
            GROUP BY c.id, c.name, c.imei, c.notes, c.config
            HAVING COUNT(*) >= :threshold
            ORDER BY COUNT(*) DESC
        """),
        {
            'project_id': project_id,
            'start_of_day': start_of_day,
            'end_of_day': end_of_day,
            'threshold': threshold
        }
    )

    cameras = []
    for row in result:
        cameras.append({
            'id': row.id,
            'name': row.name,
            'imei': row.imei,
            'notes': row.notes,
            'image_count': row.image_count,
            'lat': float(row.lat) if row.lat is not None else None,
            'lon': float(row.lon) if row.lon is not None else None,
        })

    return cameras


def _generate_text_content(
    project_name: str,
    report_date: date,
    threshold: int,
    cameras: List[Dict[str, Any]],
    images_url: str,
    settings_url: str
) -> str:
    """Generate plain text version of the excessive image alert."""
    lines = [
        f"{project_name} - Excessive image alert",
        f"Date: {report_date.strftime('%B %d, %Y')}",
        "=" * 50,
        "",
        f"{len(cameras)} camera(s) exceeded the threshold of {threshold} images:",
        ""
    ]

    for cam in cameras:
        lines.append(f"  {cam['name']}")
        if cam['imei']:
            lines.append(f"    IMEI: {cam['imei']}")
        lines.append(f"    Images: {cam['image_count']}")
        lines.append(f"    View: {images_url}?camera_id={cam['id']}&show_empty=true")
        if cam['lat'] is not None and cam['lon'] is not None:
            lines.append(f"    Location: {cam['lat']:.6f}, {cam['lon']:.6f}")
            lines.append(f"    Map: https://www.google.com/maps?q={cam['lat']},{cam['lon']}")
        if cam['notes']:
            lines.append(f"    Notes: {cam['notes']}")
        lines.append("")

    lines.extend([
        "-" * 50,
        f"View images: {images_url}",
        f"Manage notifications: {settings_url}",
        "",
        "AddaxAI Connect - Camera trap image processing"
    ])

    return "\n".join(lines)
