"""
Excessive image alert — daily digest email.

Cameras pointed at waving grass or direct sunlight trigger excessively,
sending dozens of images per day. This module sends a daily email listing
cameras that exceeded a configurable image threshold (default 50).
"""
from typing import List, Dict, Any, Optional, Tuple
from datetime import date, datetime, timedelta, timezone

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

logger = get_logger("notifications.excessive_images")
settings = get_settings()

DEFAULT_THRESHOLD = 50


def send_excessive_image_alerts() -> None:
    """
    Scheduled job: Check yesterday's image counts per camera and email
    users whose cameras exceeded their configured threshold.

    "Yesterday" is computed in the configured server timezone (defaulting to
    UTC if unset), so the alert window matches the local calendar day users
    see in the UI.
    """
    logger.info("Starting excessive image alert check")

    # Phase 1: load eligible (user, project, threshold) tuples in a
    # short-lived session. We materialise everything into plain Python
    # values so the loop below is fully decoupled from this session.
    with get_sync_session() as db:
        eligible = _load_eligible_users(db)
        tz = get_server_timezone(db)

    if not eligible:
        logger.info("No users with excessive image alerts enabled")
        return

    # Compute "yesterday" in the server's local timezone as naive day boundaries.
    # Image.captured_at is stored naive in the same interpretation, so the comparison
    # is apples-to-apples and the filter hits the index.
    yesterday_local = (datetime.now(tz) - timedelta(days=1)).date()
    start_of_day = datetime(yesterday_local.year, yesterday_local.month, yesterday_local.day)
    end_of_day = start_of_day + timedelta(days=1)

    logger.info(
        "Processing excessive image alerts",
        user_project_count=len(eligible),
        date=yesterday_local.isoformat(),
        timezone=str(tz),
    )

    email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
    messages_queued = 0

    # Phase 2: one fresh session per user-project pair. A failure in one
    # iteration cleanly rolls back its own session and the next iteration
    # starts on a brand-new one — no cross-user transaction poisoning.
    for user_id, user_email, project_id, project_name, threshold in eligible:
        try:
            with get_sync_session() as db:
                cameras = _get_cameras_over_threshold(
                    db, project_id, start_of_day, end_of_day, threshold
                )

                if not cameras:
                    continue

                domain = settings.domain_name or "localhost:3000"
                images_url = f"https://{domain}/projects/{project_id}/images"
                settings_url = f"https://{domain}/projects/{project_id}/notifications"

                template_data = {
                    'project_name': project_name,
                    'date_label': yesterday_local.strftime('%B %d, %Y'),
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
                    project_name, yesterday_local, threshold, cameras, images_url, settings_url
                )

                subject = f"{project_name} - Excessive image alert ({yesterday_local.strftime('%B %d, %Y')})"

                trigger_data = {
                    'project_id': project_id,
                    'project_name': project_name,
                    'date': yesterday_local.isoformat(),
                    'threshold': threshold,
                    'cameras_flagged': len(cameras),
                    'generated_at': datetime.now(timezone.utc).isoformat()
                }

                log_id = create_notification_log(
                    user_id=user_id,
                    notification_type='excessive_images',
                    channel='email',
                    trigger_data=trigger_data,
                    message_content=text_content[:1000]
                )

                email_queue.publish({
                    'notification_log_id': log_id,
                    'to_email': user_email,
                    'subject': subject,
                    'body_text': text_content,
                    'body_html': html_content
                })

            messages_queued += 1

            logger.info(
                "Queued excessive image alert",
                user_id=user_id,
                user_email=user_email,
                project_id=project_id,
                cameras_flagged=len(cameras),
                log_id=log_id
            )

        except Exception as e:
            logger.error(
                "Failed to process excessive image alert for user",
                user_id=user_id,
                project_id=project_id,
                error=str(e),
                exc_info=True
            )
            continue

    logger.info(
        "Excessive image alerts completed",
        total_checked=len(eligible),
        messages_queued=messages_queued
    )


def _load_eligible_users(db) -> List[Tuple[int, str, int, str, int]]:
    """
    Return (user_id, user_email, project_id, project_name, threshold) for
    every active+verified user who has excessive_images alerts enabled.

    Pulls scalar fields out of the ORM rows so they can be safely used
    after the session closes.
    """
    query = (
        select(ProjectNotificationPreference, User, Project)
        .join(User, ProjectNotificationPreference.user_id == User.id)
        .join(Project, ProjectNotificationPreference.project_id == Project.id)
        .where(
            User.is_active == True,
            User.is_verified == True,
        )
    )

    eligible: List[Tuple[int, str, int, str, int]] = []
    for pref, user, project in db.execute(query).all():
        config = _get_excessive_images_config(pref)
        if not config:
            continue
        if not user.email:
            logger.warning(
                "No email address for user",
                user_id=user.id,
                project_id=project.id,
            )
            continue
        threshold = config.get('threshold', DEFAULT_THRESHOLD)
        eligible.append((user.id, user.email, project.id, project.name, threshold))

    return eligible


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
    Query cameras that received `threshold` or more images yesterday.

    Returns list of dicts with camera details and image count.
    """
    # GROUP BY c.id only — c.id is the cameras primary key, so PostgreSQL
    # treats every other cameras column (including the JSON `c.config`
    # expressions in the SELECT list) as functionally dependent on it. We
    # cannot list `c.config` directly in GROUP BY because it is a `json`
    # column and `json` has no equality operator in PostgreSQL.
    result = db.execute(
        text("""
            SELECT c.id, c.name, c.device_id, c.notes, COUNT(*) as image_count,
                   (c.config->'gps_from_report'->>'lat')::float as lat,
                   (c.config->'gps_from_report'->>'lon')::float as lon
            FROM images i
            JOIN cameras c ON i.camera_id = c.id
            WHERE c.project_id = :project_id
              AND i.captured_at >= :start_of_day
              AND i.captured_at < :end_of_day
            GROUP BY c.id
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
            'device_id': row.device_id,
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
        if cam['device_id']:
            lines.append(f"    Camera ID: {cam['device_id']}")
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
