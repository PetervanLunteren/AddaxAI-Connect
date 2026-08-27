"""
Camera condition alert rules — daily evaluation.

Each row in `camera_alert_rules` is a private, user-created rule: battery
below X percent, SD card above Y percent, camera silent for Z days, or
N or more rejected files in the last day, scoped to selected cameras or
all cameras of the project. Every morning at 07:00 UTC active rules are
evaluated against the latest camera health reports, image arrivals and
rejections, and the creator (the only recipient) gets one
message per rule listing the newly offending cameras, by email and/or
Telegram as configured on the rule.

Once per incident: `notified_camera_ids` holds the cameras already
alerted for. Only cameras newly entering the offending state trigger a
message; recovered cameras are silently removed from the state, which
re-arms the rule for them. No recovery notifications.

Silence semantics: "silent" means the server has not heard from the
camera, measured by server receive times (health report arrival and live
image ingestion), never by the camera clock, so a camera with a wrong
clock cannot dodge or trigger the rule. Bulk-uploaded images do not
count, a human carrying an SD card in is not the camera transmitting.
This covers camera models that never send health reports (they still
send images). Cameras the server has never heard from at all are
excluded, a freshly registered camera should not alarm on day one.
Battery and SD rules can only fire for cameras that send health reports.

Rejections: a rejected file is one ingestion refused (no GPS fix, no
date) and attributed to the camera by its device id. The rule counts the
rows of the last 24 hours before the run, so a camera that rejected
yesterday and is fine today reads zero and re-arms. Only rejections that
resolved to a registered camera count; files without a device id cannot
be attributed to anyone.
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
    ProjectMembership,
    ProjectNotificationPreference,
    Rejection,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import (
    camera_ids_at_current_sites,
    create_notification_log,
    get_camera_site_label,
    get_server_timezone,
)
from text_format import md_escape

logger = get_logger("notifications.camera_alerts")
settings = get_settings()


@dataclass
class CamState:
    """Everything a rule needs to know about one camera."""
    device_id: Optional[str]
    battery_percent: Optional[int]
    sd_utilization_percent: Optional[float]
    last_seen: Optional[datetime]  # aware UTC server receive time, newer of report arrival and live image ingestion
    rejections_last_day: int = 0  # rejected files attributed to the camera in the 24 h before the run


def battery_offending(battery: Optional[int], threshold: int) -> bool:
    return battery is not None and battery < threshold


def sd_offending(sd: Optional[float], threshold: int) -> bool:
    return sd is not None and sd > threshold


def silent_offending(
    last_seen: Optional[datetime], days: int, now: datetime
) -> bool:
    # Cameras never heard from at all are excluded, see module docstring
    return last_seen is not None and (now - last_seen) > timedelta(days=days)


def rejections_offending(count: int, threshold: int) -> bool:
    # "At least", so a threshold of 1 catches the first rejected file
    return count >= threshold


def split_incidents(
    offending: List[int], previously_notified: List[int]
) -> Tuple[List[int], List[int], List[int]]:
    """Split offending cameras into (new, ongoing, recovered)."""
    off = set(offending)
    prev = set(previously_notified or [])
    return sorted(off - prev), sorted(off & prev), sorted(prev - off)


def next_notified_state(
    new: List[int], ongoing: List[int], delivered: bool
) -> List[int]:
    """The notified_camera_ids to store after a run. New offenders only
    count as notified when a message was actually queued on at least one
    channel, otherwise they stay unmarked and retry the next day (a
    telegram-only rule without a linked chat must not swallow alerts).
    Recovered cameras are dropped by construction, they are in neither
    input."""
    return sorted(set(ongoing) | set(new)) if delivered else sorted(ongoing)


def rule_label(rule_type: str, threshold: int) -> str:
    if rule_type == "battery_low":
        return f"with battery below {threshold}%"
    if rule_type == "sd_full":
        return f"with the SD card above {threshold}% full"
    if rule_type == "camera_silent":
        return f"silent for more than {threshold} day{'s' if threshold != 1 else ''}"
    if rule_type == "rejections":
        return f"with {threshold} or more rejected file{'s' if threshold != 1 else ''} in the last day"
    raise ValueError(f"Unknown rule type {rule_type}")


def value_label(rule_type: str, state: CamState) -> str:
    if rule_type == "battery_low":
        return f"{state.battery_percent}%"
    if rule_type == "sd_full":
        return f"{round(state.sd_utilization_percent)}% full"
    if rule_type == "camera_silent":
        return f"last seen {state.last_seen.strftime('%b %d, %Y')}"
    if rule_type == "rejections":
        n = state.rejections_last_day
        return f"{n} rejected file{'s' if n != 1 else ''}"
    raise ValueError(f"Unknown rule type {rule_type}")


def offending_cameras(
    rule: CameraAlertRule,
    states: Dict[int, CamState],
    now: datetime,
    allowed_camera_ids: Optional[set] = None,
) -> List[int]:
    """Camera ids currently violating the rule, within the rule's scope.

    allowed_camera_ids is a site-restricted creator's camera allow-list
    (None = unrestricted); it clamps both an explicit camera scope and
    the null all-cameras scope, so rules created before a restriction
    cannot report other sites' cameras. Stale ids of deleted cameras
    drop out naturally because they are no longer in the project state
    map.
    """
    if rule.camera_ids:
        scope = [c for c in rule.camera_ids if c in states]
    else:
        scope = list(states.keys())
    if allowed_camera_ids is not None:
        scope = [c for c in scope if c in allowed_camera_ids]

    result = []
    for camera_id in scope:
        state = states[camera_id]
        if rule.rule_type == "battery_low" and battery_offending(state.battery_percent, rule.threshold):
            result.append(camera_id)
        elif rule.rule_type == "sd_full" and sd_offending(state.sd_utilization_percent, rule.threshold):
            result.append(camera_id)
        elif rule.rule_type == "camera_silent" and silent_offending(state.last_seen, rule.threshold, now):
            result.append(camera_id)
        elif rule.rule_type == "rejections" and rejections_offending(state.rejections_last_day, rule.threshold):
            result.append(camera_id)
    return sorted(result)


def send_camera_condition_alerts() -> None:
    """Scheduled job. Evaluate every active rule and notify creators about
    cameras newly entering the offending state."""
    logger.info("Starting camera condition alert check")

    with get_sync_session() as db:
        # Silence is measured with server receive times (aware UTC); the
        # server timezone is only needed for the human-readable run date
        tz = get_server_timezone(db)
        now_utc = datetime.now(timezone.utc)
        run_date = datetime.now(tz).date()

        rows = list(db.execute(
            select(
                CameraAlertRule, User, Project,
                ProjectMembership.role, ProjectMembership.site_ids,
            )
            .join(User, CameraAlertRule.created_by_user_id == User.id)
            .join(Project, CameraAlertRule.project_id == Project.id)
            .outerjoin(
                ProjectMembership,
                (ProjectMembership.user_id == User.id)
                & (ProjectMembership.project_id == CameraAlertRule.project_id),
            )
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
        # (project_id, frozenset(site_ids)) -> allowed camera ids
        allowed_cache: Dict[tuple, set] = {}
        fired = 0
        quiet = 0
        skipped_no_access = 0
        failed = 0

        for rule, user, project, membership_role, membership_site_ids in rows:
            try:
                if membership_role is None and not user.is_superuser:
                    logger.warning(
                        "Skipping alert rule; creator has no project membership",
                        rule_id=rule.id,
                        project_id=project.id,
                        user_id=user.id,
                    )
                    skipped_no_access += 1
                    continue

                # A site-restricted viewer's rule only covers cameras whose
                # current site is in their allow-list
                allowed_camera_ids = None
                if membership_role == 'project-viewer' and membership_site_ids is not None:
                    cache_key = (project.id, frozenset(membership_site_ids))
                    if cache_key not in allowed_cache:
                        allowed_cache[cache_key] = camera_ids_at_current_sites(
                            db, project.id, membership_site_ids,
                        )
                    allowed_camera_ids = allowed_cache[cache_key]

                if project.id not in state_cache:
                    state_cache[project.id] = _load_camera_states(db, project.id, now_utc)
                states = state_cache[project.id]

                offending = offending_cameras(rule, states, now_utc, allowed_camera_ids)
                new, ongoing, recovered = split_incidents(
                    offending, rule.notified_camera_ids
                )

                delivered = False
                if new:
                    delivered = _notify(
                        email_queue, telegram_queue, db,
                        rule, user, project, states, new, run_date,
                    )
                    if delivered:
                        fired += 1
                    else:
                        # Nothing could be queued (for example a
                        # telegram-only rule without a linked chat). The
                        # new offenders stay unmarked so tomorrow retries
                        # instead of silently swallowing the alert.
                        logger.warning(
                            "Alert rule fired but no channel delivered",
                            rule_id=rule.id,
                            new_camera_ids=new,
                        )
                        quiet += 1
                else:
                    quiet += 1

                next_state = next_notified_state(new, ongoing, delivered)
                if next_state != sorted(rule.notified_camera_ids or []):
                    # Records delivered incidents and silently clears
                    # recovered cameras, which re-arms the rule for them
                    rule.notified_camera_ids = next_state

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


def _load_camera_states(db, project_id: int, now: datetime) -> Dict[int, CamState]:
    """One state entry per camera of the project, from the latest health
    report, the last image arrival and the rejections of the last day."""
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

    # Latest health report values per camera (battery, SD). The per-day
    # unique index guarantees the max-join-back returns one row per camera.
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

    # last_seen uses server receive times, never the camera clock: the
    # arrival of the latest health report, and the ingestion of the
    # latest live image (bulk uploads excluded, a carried-in SD card is
    # not the camera transmitting)
    for row in db.execute(
        select(
            CameraHealthReport.camera_id,
            func.max(CameraHealthReport.created_at).label("last_report_arrival"),
        )
        .join(Camera, CameraHealthReport.camera_id == Camera.id)
        .where(Camera.project_id == project_id)
        .group_by(CameraHealthReport.camera_id)
    ).all():
        cameras[row.camera_id].last_seen = row.last_report_arrival

    for row in db.execute(
        select(Image.camera_id, func.max(Image.ingested_at).label("last_ingested_at"))
        .join(Camera, Image.camera_id == Camera.id)
        .where(Camera.project_id == project_id, Image.origin == 'live')
        .group_by(Image.camera_id)
    ).all():
        state = cameras[row.camera_id]
        if state.last_seen is None or row.last_ingested_at > state.last_seen:
            state.last_seen = row.last_ingested_at

    # Rejected files of the last 24 hours, by server receive time
    for row in db.execute(
        select(Rejection.camera_id, func.count(Rejection.id).label("count"))
        .join(Camera, Rejection.camera_id == Camera.id)
        .where(Camera.project_id == project_id, Rejection.rejected_at > now - timedelta(days=1))
        .group_by(Rejection.camera_id)
    ).all():
        cameras[row.camera_id].rejections_last_day = row.count

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
    run_date,
) -> bool:
    """Send one message per configured channel listing the new offenders.
    Returns True when at least one channel actually queued a message."""
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
        "run_date": run_date.isoformat(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    subject = (
        f"{project.name}: {count} camera{'s' if count != 1 else ''} {label}"
    )
    text_lines = [
        f"{project.name} - camera alert",
        "=" * 50,
        "",
        f"{count} camera{'s' if count != 1 else ''} {label}.",
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

    queued = 0

    if "email" in rule.channels:
        if not user.email:
            logger.warning("Skipping email channel; user has no email", rule_id=rule.id)
        else:
            html_content, _ = render_email(
                "camera_alert.html",
                project_name=project.name,
                rule_label=label,
                date_label=run_date.strftime("%B %d, %Y"),
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
            queued += 1
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
                f"*{md_escape(project.name)}*",
                f"{count} camera{'s' if count != 1 else ''} {label}",
                "",
            ]
            for cam in cameras:
                message_lines.append(
                    f"- {md_escape(cam['site'])} - {md_escape(cam['name'])}: {cam['value_label']}"
                )
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
            queued += 1
            logger.info("Queued alert telegram", rule_id=rule.id, log_id=log_id)

    return queued > 0
