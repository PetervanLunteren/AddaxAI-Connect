"""
Camera condition alert rules — daily evaluation.

Each row in `camera_alert_rules` is a private, user-created rule: battery
below X percent, SD card above Y percent, or camera silent for Z days,
scoped to selected cameras or all cameras of the project. Every morning
at 07:00 UTC active rules are evaluated against the latest camera health
reports and image arrivals, and the creator (the only recipient) gets one
message per rule listing the newly offending cameras, by email and/or
Telegram as configured on the rule.

Once per incident: `notified_camera_ids` holds the cameras already
alerted for. Only cameras newly entering the offending state trigger a
message; recovered cameras are silently removed from the state, which
re-arms the rule for them. No recovery notifications.

Silence semantics: "silent" means nothing heard at all, the newer of the
last health report and the last image. This covers camera models that
never send health reports (they still send images). Cameras that have
never produced either are excluded, a freshly registered camera should
not alarm on day one. Battery and SD rules can only fire for cameras
that send health reports.

Timestamps: `reported_at` and `captured_at` are naive camera-clock values
interpreted under the server timezone, so comparisons use the naive
server-local now (see DEVELOPERS.md, timestamp conventions).
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import (
    Camera,
    CameraAlertRule,
    CameraHealthReport,
    Image,
    Project,
    ProjectNotificationPreference,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import (
    create_notification_log,
    get_camera_site_label,
    get_server_timezone,
    has_project_access,
)

logger = get_logger("notifications.camera_alerts")
settings = get_settings()


@dataclass
class CamState:
    """Everything a rule needs to know about one camera."""
    device_id: Optional[str]
    battery_percent: Optional[int]
    sd_utilization_percent: Optional[float]
    last_seen: Optional[datetime]  # naive camera-clock, newer of report/image


def battery_offending(battery: Optional[int], threshold: int) -> bool:
    return battery is not None and battery < threshold


def sd_offending(sd: Optional[float], threshold: int) -> bool:
    return sd is not None and sd > threshold


def silent_offending(
    last_seen: Optional[datetime], days: int, naive_now: datetime
) -> bool:
    # Cameras never heard from at all are excluded, see module docstring
    return last_seen is not None and (naive_now - last_seen) > timedelta(days=days)


def split_incidents(
    offending: List[int], previously_notified: List[int]
) -> Tuple[List[int], List[int], List[int]]:
    """Split offending cameras into (new, ongoing, recovered)."""
    off = set(offending)
    prev = set(previously_notified or [])
    return sorted(off - prev), sorted(off & prev), sorted(prev - off)


def rule_label(rule_type: str, threshold: int) -> str:
    if rule_type == "battery_low":
        return f"battery below {threshold}%"
    if rule_type == "sd_full":
        return f"SD card above {threshold}% full"
    if rule_type == "camera_silent":
        return f"silent for more than {threshold} day{'s' if threshold != 1 else ''}"
    raise ValueError(f"Unknown rule type {rule_type}")


def value_label(rule_type: str, state: CamState) -> str:
    if rule_type == "battery_low":
        return f"{state.battery_percent}%"
    if rule_type == "sd_full":
        return f"{round(state.sd_utilization_percent)}% full"
    if rule_type == "camera_silent":
        return f"last seen {state.last_seen.strftime('%b %d')}"
    raise ValueError(f"Unknown rule type {rule_type}")


def offending_cameras(
    rule: CameraAlertRule,
    states: Dict[int, CamState],
    naive_now: datetime,
) -> List[int]:
    """Camera ids currently violating the rule, within the rule's scope.

    Stale ids of deleted cameras drop out naturally because they are no
    longer in the project state map.
    """
    if rule.camera_ids:
        scope = [c for c in rule.camera_ids if c in states]
    else:
        scope = list(states.keys())

    result = []
    for camera_id in scope:
        state = states[camera_id]
        if rule.rule_type == "battery_low" and battery_offending(state.battery_percent, rule.threshold):
            result.append(camera_id)
        elif rule.rule_type == "sd_full" and sd_offending(state.sd_utilization_percent, rule.threshold):
            result.append(camera_id)
        elif rule.rule_type == "camera_silent" and silent_offending(state.last_seen, rule.threshold, naive_now):
            result.append(camera_id)
    return sorted(result)


def send_camera_condition_alerts() -> None:
    """Scheduled job. Evaluate every active rule and notify creators about
    cameras newly entering the offending state."""
    logger.info("Starting camera condition alert check")

    with get_sync_session() as db:
        tz = get_server_timezone(db)
        naive_now = datetime.now(tz).replace(tzinfo=None)

        rows = list(db.execute(
            select(CameraAlertRule, User, Project)
            .join(User, CameraAlertRule.created_by_user_id == User.id)
            .join(Project, CameraAlertRule.project_id == Project.id)
            .where(
                CameraAlertRule.is_active == True,
                User.is_active == True,
                User.is_verified == True,
            )
            .order_by(CameraAlertRule.project_id.asc(), CameraAlertRule.id.asc())
        ).all())

        if not rows:
            logger.info("No active alert rules")
            return

        logger.info("Evaluating alert rules", count=len(rows))

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
        state_cache: Dict[int, Dict[int, CamState]] = {}
        fired = 0
        quiet = 0
        skipped_no_access = 0
        failed = 0

        for rule, user, project in rows:
            try:
                if not has_project_access(db, user.id, project.id):
                    logger.warning(
                        "Skipping alert rule; creator has no project access",
                        rule_id=rule.id,
                        project_id=project.id,
                        user_id=user.id,
                    )
                    skipped_no_access += 1
                    continue

                if project.id not in state_cache:
                    state_cache[project.id] = _load_camera_states(db, project.id)
                states = state_cache[project.id]

                offending = offending_cameras(rule, states, naive_now)
                new, ongoing, recovered = split_incidents(
                    offending, rule.notified_camera_ids
                )

                if new:
                    _notify(
                        email_queue, telegram_queue, db,
                        rule, user, project, states, new, naive_now,
                    )
                    fired += 1
                else:
                    quiet += 1

                if sorted(offending) != sorted(rule.notified_camera_ids or []):
                    # Records new incidents and silently clears recovered
                    # cameras, which re-arms the rule for them
                    rule.notified_camera_ids = sorted(offending)

            except Exception as exc:
                logger.error(
                    "Failed to process alert rule",
                    rule_id=rule.id,
                    project_id=project.id,
                    error=str(exc),
                    exc_info=True,
                )
                failed += 1
                continue

        db.commit()

        logger.info(
            "Camera condition alert check complete",
            total=len(rows),
            fired=fired,
            quiet=quiet,
            skipped_no_access=skipped_no_access,
            failed=failed,
        )


def _load_camera_states(db, project_id: int) -> Dict[int, CamState]:
    """One state entry per camera of the project, from the latest health
    report and the last image arrival."""
    cameras = {
        row.id: CamState(
            device_id=row.device_id,
            battery_percent=None,
            sd_utilization_percent=None,
            last_seen=None,
        )
        for row in db.execute(
            select(Camera.id, Camera.device_id).where(Camera.project_id == project_id)
        ).all()
    }
    if not cameras:
        return cameras

    # Latest health report per camera. The per-day unique index guarantees
    # the max-join-back returns one row per camera.
    latest = (
        select(
            CameraHealthReport.camera_id,
            func.max(CameraHealthReport.reported_at).label("last_reported_at"),
        )
        .join(Camera, CameraHealthReport.camera_id == Camera.id)
        .where(Camera.project_id == project_id)
        .group_by(CameraHealthReport.camera_id)
        .subquery()
    )
    for row in db.execute(
        select(
            CameraHealthReport.camera_id,
            CameraHealthReport.reported_at,
            CameraHealthReport.battery_percent,
            CameraHealthReport.sd_utilization_percent,
        ).join(
            latest,
            and_(
                CameraHealthReport.camera_id == latest.c.camera_id,
                CameraHealthReport.reported_at == latest.c.last_reported_at,
            ),
        )
    ).all():
        state = cameras[row.camera_id]
        state.battery_percent = row.battery_percent
        state.sd_utilization_percent = row.sd_utilization_percent
        state.last_seen = row.reported_at

    # Last image per camera, covers cameras that never send health reports
    for row in db.execute(
        select(Image.camera_id, func.max(Image.captured_at).label("last_captured_at"))
        .join(Camera, Image.camera_id == Camera.id)
        .where(Camera.project_id == project_id)
        .group_by(Image.camera_id)
    ).all():
        state = cameras[row.camera_id]
        if state.last_seen is None or row.last_captured_at > state.last_seen:
            state.last_seen = row.last_captured_at

    return cameras


def _camera_lines(
    rule: CameraAlertRule, states: Dict[int, CamState], camera_ids: List[int]
) -> List[Dict[str, str]]:
    lines = []
    for camera_id in camera_ids:
        state = states[camera_id]
        site = get_camera_site_label(camera_id)
        lines.append({
            "name": state.device_id or f"Camera {camera_id}",
            "site": site or "No site",
            "value_label": value_label(rule.rule_type, state),
        })
    return lines


def _notify(
    email_queue: RedisQueue,
    telegram_queue: RedisQueue,
    db,
    rule: CameraAlertRule,
    user: User,
    project: Project,
    states: Dict[int, CamState],
    new_camera_ids: List[int],
    naive_now: datetime,
) -> None:
    """Send one message per configured channel listing the new offenders."""
    domain = settings.domain_name or "localhost:3000"
    cameras_url = f"https://{domain}/projects/{project.id}/cameras"
    settings_url = f"https://{domain}/projects/{project.id}/notifications"

    label = rule_label(rule.rule_type, rule.threshold)
    cameras = _camera_lines(rule, states, new_camera_ids)
    count = len(cameras)

    trigger_data = {
        "rule_id": rule.id,
        "rule_type": rule.rule_type,
        "threshold": rule.threshold,
        "project_id": project.id,
        "project_name": project.name,
        "camera_ids": new_camera_ids,
        "run_date": naive_now.date().isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    subject = (
        f"{project.name}: {count} camera{'s' if count != 1 else ''} {label}"
    )
    text_lines = [
        f"{project.name} - camera alert",
        "=" * 50,
        "",
        f"{count} camera{'s' if count != 1 else ''} now {label}.",
        "",
    ]
    for cam in cameras:
        text_lines.append(f"- {cam['site']} - {cam['name']}: {cam['value_label']}")
    text_lines += [
        "",
        "-" * 50,
        f"View cameras: {cameras_url}",
        f"Manage alert rules: {settings_url}",
        "",
        "AddaxAI Connect - Camera trap image processing",
    ]
    text_content = "\n".join(text_lines)

    if "email" in rule.channels:
        if not user.email:
            logger.warning("Skipping email channel; user has no email", rule_id=rule.id)
        else:
            html_content, _ = render_email(
                "camera_alert.html",
                project_name=project.name,
                rule_label=label,
                date_label=naive_now.strftime("%B %d, %Y"),
                camera_count=count,
                cameras=cameras,
                cameras_url=cameras_url,
                settings_url=settings_url,
            )
            log_id = create_notification_log(
                user_id=user.id,
                notification_type="camera_alert",
                channel="email",
                trigger_data=trigger_data,
                message_content=text_content[:1000],
            )
            email_queue.publish({
                "notification_log_id": log_id,
                "to_email": user.email,
                "subject": subject,
                "body_text": text_content,
                "body_html": html_content,
            })
            logger.info("Queued alert email", rule_id=rule.id, log_id=log_id)

    if "telegram" in rule.channels:
        chat_id = db.execute(
            select(ProjectNotificationPreference.telegram_chat_id).where(
                ProjectNotificationPreference.user_id == user.id,
                ProjectNotificationPreference.project_id == project.id,
                ProjectNotificationPreference.telegram_chat_id.isnot(None),
            )
        ).scalar_one_or_none()
        if not chat_id:
            logger.warning(
                "Skipping telegram channel; no linked chat",
                rule_id=rule.id,
                user_id=user.id,
            )
        else:
            message_lines = [
                f"*{project.name}*",
                f"{count} camera{'s' if count != 1 else ''} now {label}",
                "",
            ]
            for cam in cameras:
                message_lines.append(f"- {cam['site']} - {cam['name']}: {cam['value_label']}")
            message_text = "\n".join(message_lines)

            log_id = create_notification_log(
                user_id=user.id,
                notification_type="camera_alert",
                channel="telegram",
                trigger_data=trigger_data,
                message_content=message_text[:1000],
            )
            telegram_queue.publish({
                "notification_log_id": log_id,
                "chat_id": chat_id,
                "message_text": message_text,
                "annotated_minio_path": None,
                "reply_markup": {
                    "inline_keyboard": [[{"text": "View cameras", "url": cameras_url}]]
                },
            })
            logger.info("Queued alert telegram", rule_id=rule.id, log_id=log_id)
