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
    ProjectMembership,
    ProjectNotificationPreference,
    User,
    Project
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import (
    create_notification_log,
    get_server_timezone,
    project_wide_email_skip_reason,
)

logger = get_logger("notifications.excessive_images")
settings = get_settings()

DEFAULT_THRESHOLD = 50

# A camera whose last picture landed just before midnight tells you nothing,
# so the quiet tail only earns a line once the gap is at least this long.
MIN_QUIET_TAIL = timedelta(hours=1)


def format_quiet_tail(last_image: datetime, end_of_day: datetime) -> Optional[str]:
    """
    How long the camera stayed silent between its last picture and midnight,
    as "9h 49m", or None when the gap is too short to be worth saying.

    This is a plain fact, not a claim that the camera was blocked. These
    cameras cap how many pictures they transmit per day in hardware, so one
    that lands exactly on its cap in the early afternoon has stopped sending
    rather than run out of animals. The reader gets the count and both times
    and can tell those two apart. We deliberately do not estimate how many
    pictures were missed, that needs a trigger rate we do not have.
    """
    gap = end_of_day - last_image
    if gap < MIN_QUIET_TAIL:
        return None
    hours, remainder = divmod(int(gap.total_seconds()), 3600)
    minutes = remainder // 60
    return f"{hours}h {minutes}m" if minutes else f"{hours}h"


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
        select(
            ProjectNotificationPreference, User, Project,
            ProjectMembership.role, ProjectMembership.site_ids,
        )
        .join(User, ProjectNotificationPreference.user_id == User.id)
        .join(Project, ProjectNotificationPreference.project_id == Project.id)
        .outerjoin(
            ProjectMembership,
            (ProjectMembership.user_id == User.id)
            & (ProjectMembership.project_id == ProjectNotificationPreference.project_id),
        )
        .where(
            User.is_active == True,
            User.is_verified == True,
        )
    )

    eligible: List[Tuple[int, str, int, str, int]] = []
    for pref, user, project, membership_role, membership_site_ids in db.execute(query).all():
        # The alert carries site names and camera GPS for the whole
        # project, so skip users without a current membership and
        # site-restricted viewers
        skip = project_wide_email_skip_reason(
            user.is_superuser, membership_role, membership_site_ids,
        )
        if skip:
            logger.info(
                "Skipping excessive image alert recipient",
                user_id=user.id,
                project_id=project.id,
                reason=skip,
            )
            continue
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
            SELECT c.id, c.device_id, c.notes, COUNT(*) as image_count,
                   MIN(i.captured_at) as first_image,
                   MAX(i.captured_at) as last_image,
                   (c.config->'gps_from_report'->>'lat')::float as lat,
                   (c.config->'gps_from_report'->>'lon')::float as lon,
                   (SELECT s.name FROM deployments d JOIN sites s ON s.id = d.site_id
                    WHERE d.camera_id = c.id
                    ORDER BY (d.end_date IS NULL) DESC, d.start_date DESC
                    LIMIT 1) as site_name
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
            'site_name': row.site_name,
            'device_id': row.device_id,
            'notes': row.notes,
            'image_count': row.image_count,
            # captured_at is the camera clock, stored naive and read under the
            # same timezone that built the day window above, so the clock time
            # can be formatted as-is. No conversion, see the timestamp rules in
            # DEVELOPERS.md.
            'first_image': row.first_image.strftime('%H:%M'),
            'last_image': row.last_image.strftime('%H:%M'),
            'quiet_tail': format_quiet_tail(row.last_image, end_of_day),
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
        # Lead with the site (the place); the device id is shown once below it.
        header = cam['site_name'] or cam['device_id']
        lines.append(f"  {header}")
        if cam['site_name'] and cam['device_id']:
            lines.append(f"    Camera ID: {cam['device_id']}")
        lines.append(
            f"    {cam['image_count']} images, "
            f"{cam['first_image']} to {cam['last_image']}"
        )
        if cam['quiet_tail']:
            lines.append(
                f"    No images for the last {cam['quiet_tail']} of the day"
            )
        lines.append(f"    View: {images_url}?camera_id={cam['id']}&show_empty=true")
        if cam['lat'] is not None and cam['lon'] is not None:
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
