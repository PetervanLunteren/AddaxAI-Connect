"""
SIM expiry alert — monthly check on the 1st.

Each project admin who opted in receives one email per month listing every
camera in the project whose `sim_expiry_date` falls on or before the 1st of
the second-next month. Already-expired cameras always match. The cron fires
on the 1st of every month, so the same camera surfaces every month until the
date is bumped past the 2-month window.
"""
from typing import Dict, List, Optional, Any
from datetime import date, datetime, timezone

from sqlalchemy import select

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    Camera,
    Project,
    ProjectMembership,
    ProjectNotificationPreference,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import create_notification_log

logger = get_logger("notifications.sim_expiry")
settings = get_settings()

# How far ahead the cron looks. Calendar-aligned: a camera matches if its
# sim_expiry_date is on or before the 1st of (run_month + LOOKAHEAD_MONTHS).
LOOKAHEAD_MONTHS = 2

# Inside this many days of expiry we tag the camera as "expiring soon" in the
# email. Cameras already past their expiry get the harder "expired" tag.
EXPIRING_SOON_WINDOW_DAYS = 30


def send_sim_expiry_alerts() -> None:
    """
    Scheduled job: for each project admin who opted in, email a list of
    cameras whose SIM card expires within the lookahead window or has
    already expired.
    """
    logger.info("Starting SIM expiry alert check")

    run_date = date.today()
    threshold = _start_of_month_plus(run_date, LOOKAHEAD_MONTHS)

    with get_sync_session() as db:
        # All admins who opted in, grouped per project. Server admins are
        # included implicitly by the membership query plus the is_superuser
        # branch in _is_project_admin below.
        eligible = _load_eligible_admins(db)

        if not eligible:
            logger.info("No project admins with SIM expiry alerts enabled")
            return

        logger.info(
            "Processing SIM expiry alerts",
            user_project_count=len(eligible),
            threshold=threshold.isoformat(),
        )

        # Cache the per-project camera list. Each project queried at most
        # once per run regardless of how many admins opted in.
        cameras_by_project: Dict[int, List[Dict[str, Any]]] = {}

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        messages_queued = 0

        for user_id, user_email, project_id, project_name in eligible:
            try:
                if project_id not in cameras_by_project:
                    cameras_by_project[project_id] = _expiring_cameras(
                        db, project_id, threshold, run_date
                    )
                cameras = cameras_by_project[project_id]

                if not cameras:
                    continue

                if not user_email:
                    logger.warning(
                        "No email address for user", user_id=user_id, project_id=project_id
                    )
                    continue

                domain = settings.domain_name or "localhost:3000"
                cameras_url = f"https://{domain}/projects/{project_id}/cameras"
                settings_url = f"https://{domain}/projects/{project_id}/notifications"

                template_data = {
                    "project_name": project_name,
                    "date_label": run_date.strftime("%B %d, %Y"),
                    "threshold_label": threshold.strftime("%B %d, %Y"),
                    "camera_count": len(cameras),
                    "cameras": cameras,
                    "cameras_url": cameras_url,
                    "settings_url": settings_url,
                }

                html_content, _ = render_email(
                    "sim_expiry_alert.html", **template_data
                )
                text_content = _generate_text_content(
                    project_name, threshold, cameras, cameras_url, settings_url
                )

                subject = (
                    f"{project_name} - {len(cameras)} SIM card"
                    f"{'s' if len(cameras) != 1 else ''} expiring soon"
                )

                trigger_data = {
                    "project_id": project_id,
                    "project_name": project_name,
                    "run_date": run_date.isoformat(),
                    "threshold": threshold.isoformat(),
                    "camera_count": len(cameras),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }

                log_id = create_notification_log(
                    user_id=user_id,
                    notification_type="sim_expiry",
                    channel="email",
                    trigger_data=trigger_data,
                    message_content=text_content[:1000],
                )

                email_queue.publish({
                    "notification_log_id": log_id,
                    "to_email": user_email,
                    "subject": subject,
                    "body_text": text_content,
                    "body_html": html_content,
                })

                messages_queued += 1

                logger.info(
                    "Queued SIM expiry alert",
                    user_id=user_id,
                    user_email=user_email,
                    project_id=project_id,
                    camera_count=len(cameras),
                    log_id=log_id,
                )

            except Exception as exc:
                logger.error(
                    "Failed to process SIM expiry alert for user",
                    user_id=user_id,
                    project_id=project_id,
                    error=str(exc),
                    exc_info=True,
                )
                continue

        logger.info(
            "SIM expiry alerts completed",
            total_eligible=len(eligible),
            messages_queued=messages_queued,
        )


def _start_of_month_plus(reference: date, months: int) -> date:
    """
    Return the 1st day of the month `months` calendar months after the
    reference's month. Wraps year boundaries cleanly. Leap years are not a
    concern because we always anchor on day 1.
    """
    year = reference.year
    month = reference.month + months
    while month > 12:
        month -= 12
        year += 1
    return date(year, month, 1)


def _load_eligible_admins(db) -> List[tuple]:
    """
    Materialise every (user_id, email, project_id, project_name) tuple where
    the user has the SIM expiry toggle on and is allowed to receive admin
    alerts for that project.

    The frontend already gates the toggle to admins and the API rejects
    non-admin attempts to enable it, but a stale row could still exist if a
    membership was downgraded after the toggle was saved. The membership
    check here is the final filter.
    """
    rows = db.execute(
        select(ProjectNotificationPreference, User, Project)
        .join(User, ProjectNotificationPreference.user_id == User.id)
        .join(Project, ProjectNotificationPreference.project_id == Project.id)
        .where(
            User.is_active == True,
            User.is_verified == True,
        )
    ).all()

    eligible: List[tuple] = []
    for pref, user, project in rows:
        if not _sim_expiry_enabled(pref):
            continue
        if not _is_project_admin(db, user, project.id):
            continue
        eligible.append((user.id, user.email, project.id, project.name))
    return eligible


def _sim_expiry_enabled(pref: ProjectNotificationPreference) -> bool:
    """Read notification_channels.sim_expiry.enabled, treating None safely."""
    channels = pref.notification_channels
    if not channels or not isinstance(channels, dict):
        return False
    config = channels.get("sim_expiry")
    if not isinstance(config, dict):
        return False
    return bool(config.get("enabled", False))


def _is_project_admin(db, user: User, project_id: int) -> bool:
    """
    Sync version of auth.permissions.can_admin_project. Server admins always
    qualify; regular users qualify only when their project_memberships row has
    role == 'project-admin'.
    """
    if user.is_superuser:
        return True
    role = db.execute(
        select(ProjectMembership.role).where(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project_id,
        )
    ).scalar_one_or_none()
    return role == "project-admin"


def _expiring_cameras(
    db,
    project_id: int,
    threshold: date,
    run_date: date,
) -> List[Dict[str, Any]]:
    """
    Cameras in the project whose sim_expiry_date is set and falls on or
    before the threshold. Sorted by sim_expiry_date ascending so the most
    urgent (already-expired, then nearest expiry) appear first.
    """
    rows = db.execute(
        select(Camera)
        .where(
            Camera.project_id == project_id,
            Camera.sim_expiry_date.isnot(None),
            Camera.sim_expiry_date <= threshold,
        )
        .order_by(Camera.sim_expiry_date.asc())
    ).scalars().all()

    cameras: List[Dict[str, Any]] = []
    for camera in rows:
        days_until = (camera.sim_expiry_date - run_date).days
        if days_until < 0:
            status = "expired"
            status_label = (
                f"Expired {abs(days_until)} day{'s' if days_until != -1 else ''} ago"
            )
        elif days_until == 0:
            status = "expired"
            status_label = "Expires today"
        elif days_until <= EXPIRING_SOON_WINDOW_DAYS:
            status = "expiring_soon"
            status_label = (
                f"Expires in {days_until} day{'s' if days_until != 1 else ''}"
            )
        else:
            status = "upcoming"
            status_label = (
                f"Expires in {days_until} day{'s' if days_until != 1 else ''}"
            )

        cameras.append({
            "id": camera.id,
            "name": camera.name,
            "device_id": camera.device_id,
            "sim_expiry_date": camera.sim_expiry_date.isoformat(),
            "status": status,
            "status_label": status_label,
            "notes": camera.notes,
        })
    return cameras


def _generate_text_content(
    project_name: str,
    threshold: date,
    cameras: List[Dict[str, Any]],
    cameras_url: str,
    settings_url: str,
) -> str:
    """Plain-text fallback. Mirrors the HTML structure line-by-line."""
    lines = [
        f"{project_name} - SIM expiry alert",
        "=" * 50,
        "",
        f"{len(cameras)} camera{'s' if len(cameras) != 1 else ''} expiring on or before "
        f"{threshold.strftime('%B %d, %Y')}:",
        "",
    ]
    for cam in cameras:
        device_part = f" ({cam['device_id']})" if cam["device_id"] else ""
        lines.append(
            f"- {cam['name']}{device_part}: {cam['sim_expiry_date']} "
            f"-> {cam['status_label']}"
        )
    lines.extend([
        "",
        "-" * 50,
        f"View cameras: {cameras_url}",
        f"Manage notifications: {settings_url}",
        "",
        "AddaxAI Connect - Camera trap image processing",
    ])
    return "\n".join(lines)
