"""
Theft watch rules (beta) — two triggers per rule.

Each row in `theft_watch_rules` is a private, user-created rule with a
low/medium/high sensitivity preset, optionally narrowed by site,
delivered by email and/or Telegram. One rule carries two triggers:

Person trigger, live event path. Fires when a person bounding box is an
outlier against the camera's own person-box history in its current
deployment, or on any person when the camera has too little person
history (people are rare there, so any person is notable). At busy
public sites the history contains full-frame walkers and the trigger
self-disables by design. A fixed per-camera cooldown keeps one group of
walkers from firing a burst of alerts.

Silence trigger, hourly job at minute 30. Fires when a camera has been
quiet longer than its own historical contact rhythm (contact = live
image arrival or health report arrival, server receive times, never the
camera clock). The threshold is a margin over the camera's longest
recent contact gap, so chatty cameras alarm in hours and sporadic ones
in days, and the message mentions how many other nearby cameras are
also silent right now, which is the theft signature a human reads in
one glance. Once per incident with re-arm on recovery, same state
convention as the camera condition alerts.

Both triggers skip cameras whose current deployment is younger than
WARMUP_DAYS: a new spot means new habits, so the camera first learns
its normal pattern. The UI says this plainly.

Calibration: the presets below were validated against two production
datasets, including four real thefts (Duinpoort, June 2026). Real theft
frames and every evaluation land in NotificationLog trigger_data so the
presets can be re-tuned when more real cases exist. This feature is a
beta and its copy says so.
"""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, text

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.geo import calculate_gps_distance
from shared.models import (
    Camera,
    CameraHealthReport,
    Deployment,
    Detection,
    Image,
    Project,
    ProjectMembership,
    ProjectNotificationPreference,
    TheftWatchRule,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings
from shared.email_renderer import render_email

from camera_alerts import next_notified_state, split_incidents
from detection_alerts import (
    _load_event_image,
    cooldown_active,
    effective_site_scope,
    images_link,
    next_cooldown_state,
)
from db_operations import create_notification_log, get_server_timezone

logger = get_logger("notifications.theft_watch")
settings = get_settings()

# A camera first learns its normal pattern at a new spot
WARMUP_DAYS = 14
# Below this many person images the percentile is noise; any person fires
MIN_PERSON_SAMPLES = 30
PERSON_HISTORY_DAYS = 90
CONTACT_HISTORY_DAYS = 60
# Below this many contact gaps the rhythm is unknown; the camera is skipped
MIN_CONTACT_GAPS = 10
PERSON_COOLDOWN_MINUTES = 60
NEARBY_RADIUS_M = 1000.0


@dataclass(frozen=True)
class Preset:
    person_percentile: float  # percentile of the person-box area history
    person_margin: float      # multiplied onto that percentile
    silence_margin: float     # multiplied onto the longest recent contact gap
    silence_floor_hours: float


SENSITIVITY_PRESETS: Dict[str, Preset] = {
    "low": Preset(99.0, 2.0, 3.0, 48.0),
    "medium": Preset(95.0, 1.5, 2.0, 24.0),
    "high": Preset(90.0, 1.2, 1.5, 12.0),
}


@dataclass
class WatchCamState:
    """Everything the silence trigger needs to know about one camera."""
    device_id: Optional[str]
    site_id: Optional[int]
    site_name: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    dep_start: Optional[date]
    battery_percent: Optional[int]
    last_contact: Optional[datetime]  # aware UTC server receive time
    gap_hours: List[float]
    silence_hours: float


# ---- pure helpers, unit-tested without a DB ----

def percentile(values: List[float], pct: float) -> float:
    """Linear-interpolation percentile of a non-empty list, 0-100 scale.
    Small pure implementation so the service needs no numpy."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = rank - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def person_threshold(areas: List[float], sensitivity: str) -> Optional[float]:
    """Box-area threshold above which a person counts as unusually close.
    None means the camera has too little person history for a stable
    percentile; the caller then treats any person as an outlier, because
    a camera that rarely sees people makes every person notable."""
    if len(areas) < MIN_PERSON_SAMPLES:
        return None
    preset = SENSITIVITY_PRESETS[sensitivity]
    return percentile(areas, preset.person_percentile) * preset.person_margin


def person_outlier(area: float, areas: List[float], sensitivity: str) -> bool:
    threshold = person_threshold(areas, sensitivity)
    if threshold is None:
        return True
    return area > threshold


def silence_threshold_hours(
    gap_hours: List[float], sensitivity: str
) -> Optional[float]:
    """Hours of silence above which a camera counts as unusually quiet.
    None means too few gaps to know the camera's rhythm; the caller
    skips the camera rather than guessing."""
    if len(gap_hours) < MIN_CONTACT_GAPS:
        return None
    preset = SENSITIVITY_PRESETS[sensitivity]
    return max(preset.silence_floor_hours, preset.silence_margin * max(gap_hours))


def in_warmup(dep_start: Optional[date], today: date) -> bool:
    """A camera without a deployment, or one placed or moved less than
    WARMUP_DAYS ago, is still learning its normal pattern."""
    if dep_start is None:
        return True
    return (today - dep_start).days < WARMUP_DAYS


def bbox_area(bbox: Optional[Dict[str, Any]]) -> Optional[float]:
    """Scale-free box area from the stored 'normalized' [x, y, w, h].
    Rows without it (written before 2026) are skipped by returning None."""
    normalized = (bbox or {}).get("normalized")
    if not isinstance(normalized, (list, tuple)) or len(normalized) != 4:
        return None
    try:
        return float(normalized[2]) * float(normalized[3])
    except (TypeError, ValueError):
        return None


def contact_gap_hours(contacts: List[datetime]) -> List[float]:
    """Gaps between consecutive contact timestamps, in hours. The input
    must be sorted ascending."""
    return [
        (b - a).total_seconds() / 3600.0
        for a, b in zip(contacts, contacts[1:])
    ]


def nearby_silent_count(
    camera_id: int,
    offending: List[int],
    states: Dict[int, WatchCamState],
) -> Optional[int]:
    """How many OTHER currently offending cameras stand within
    NEARBY_RADIUS_M of this one. None when this camera has no
    coordinates, so the message can drop the sentence instead of lying."""
    me = states.get(camera_id)
    if me is None or me.lat is None or me.lon is None:
        return None
    count = 0
    for other_id in offending:
        if other_id == camera_id:
            continue
        other = states.get(other_id)
        if other is None or other.lat is None or other.lon is None:
            continue
        if calculate_gps_distance(me.lat, me.lon, other.lat, other.lon) <= NEARBY_RADIUS_M:
            count += 1
    return count


# ---- shared rule loading ----

def _load_rules(
    db, project_id: int
) -> List[Tuple[TheftWatchRule, User, Optional[str], Optional[List[int]]]]:
    """Active theft watch rules with their creator and the creator's
    membership, same shape and skip logic as the detection alert rules."""
    rows = db.execute(
        select(
            TheftWatchRule,
            User,
            ProjectMembership.role,
            ProjectMembership.site_ids,
        )
        .join(User, TheftWatchRule.created_by_user_id == User.id)
        .outerjoin(
            ProjectMembership,
            (ProjectMembership.user_id == User.id)
            & (ProjectMembership.project_id == TheftWatchRule.project_id),
        )
        .where(
            TheftWatchRule.project_id == project_id,
            TheftWatchRule.is_active == True,
            User.is_active == True,
            User.is_verified == True,
        )
        .order_by(TheftWatchRule.id.asc())
    ).all()

    kept = []
    for rule, user, role, membership_site_ids in rows:
        if role is None and not user.is_superuser:
            logger.warning(
                "Skipping theft watch rule; creator has no project membership",
                rule_id=rule.id,
                user_id=user.id,
            )
            continue
        kept.append((rule, user, role, membership_site_ids))
    return kept


# ---- person trigger, live event path ----

def handle_person_event(event: Dict[str, Any]) -> None:
    """Evaluate one person species_detection event against the active
    theft watch rules of its project."""
    image_uuid = event.get('image_uuid')
    project_id = event.get('project_id')
    camera_id = event.get('camera_id')
    if not all([image_uuid, project_id, camera_id]):
        logger.error("Missing required fields in person event", event=event)
        return

    with get_sync_session() as db:
        project = db.get(Project, project_id)
        if not project:
            return

        # Same gate as every other view: detections hidden by the project
        # threshold never alert
        detection_confidence = event.get('detection_confidence', event.get('confidence'))
        if detection_confidence is None or detection_confidence < project.detection_threshold:
            return

        rows = _load_rules(db, project_id)
        if not rows:
            return

        loaded = _load_event_image(db, image_uuid)
        if loaded is None:
            logger.error("Image not found for person event", image_uuid=image_uuid)
            return
        image_id, captured_at, site_id, site_name = loaded

        deployment = db.execute(
            select(Deployment.id, Deployment.start_date)
            .where(Deployment.camera_id == camera_id)
            .order_by(Deployment.end_date.is_(None).desc(), Deployment.start_date.desc())
            .limit(1)
        ).first()
        today = datetime.now(timezone.utc).date()
        if deployment is None or in_warmup(deployment.start_date, today):
            logger.debug(
                "Camera in theft watch warm-up, person trigger quiet",
                camera_id=camera_id,
            )
            return

        area = _image_person_area(db, image_id)
        if area is None:
            logger.debug("No usable person box for event", image_uuid=image_uuid)
            return

        server_tz = get_server_timezone(db)
        history_cutoff = (
            datetime.now(server_tz).replace(tzinfo=None)
            - timedelta(days=PERSON_HISTORY_DAYS)
        )
        history = _person_area_history(db, deployment.id, image_id, history_cutoff)

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
        now_utc = datetime.now(timezone.utc)
        key = str(camera_id)
        fired = 0

        for rule, user, membership_role, membership_site_ids in rows:
            try:
                site_scope = effective_site_scope(
                    membership_role, membership_site_ids, rule.site_ids,
                )
                if site_scope is not None:
                    if site_id is None or site_id not in site_scope:
                        continue
                if not person_outlier(area, history, rule.sensitivity):
                    continue
                if cooldown_active(
                    rule.person_cooldown_state, key, PERSON_COOLDOWN_MINUTES, now_utc
                ):
                    continue

                delivered = _notify_person(
                    email_queue, telegram_queue, db,
                    rule, user, project, event, captured_at, site_id, site_name,
                    area, person_threshold(history, rule.sensitivity), len(history),
                )
                if delivered:
                    fired += 1
                    rule.person_cooldown_state = next_cooldown_state(
                        rule.person_cooldown_state, key, now_utc, PERSON_COOLDOWN_MINUTES,
                    )
                else:
                    logger.warning(
                        "Theft watch person trigger matched but no channel delivered",
                        rule_id=rule.id,
                        user_id=user.id,
                    )
            except Exception as exc:
                logger.error(
                    "Failed to process theft watch rule",
                    rule_id=rule.id,
                    error=str(exc),
                    exc_info=True,
                )
                continue

        db.commit()

        logger.info(
            "Theft watch person evaluation complete",
            image_uuid=image_uuid,
            camera_id=camera_id,
            area=round(area, 3),
            history_n=len(history),
            rules=len(rows),
            fired=fired,
        )


def _image_person_area(db, image_id: int) -> Optional[float]:
    """The largest person-box area of one image, None when no person box
    carries usable normalized coordinates."""
    rows = db.execute(
        select(Detection.bbox).where(
            Detection.image_id == image_id,
            Detection.category == 'person',
        )
    ).all()
    areas = [a for (bbox,) in rows if (a := bbox_area(bbox)) is not None]
    return max(areas) if areas else None


def _person_area_history(
    db, deployment_id: int, exclude_image_id: int, cutoff_naive: datetime
) -> List[float]:
    """Largest person-box area per image over the current deployment's
    recent live images, the triggering image excluded."""
    rows = db.execute(
        select(Image.id, Detection.bbox)
        .join(Detection, Detection.image_id == Image.id)
        .where(
            Image.deployment_id == deployment_id,
            Image.origin == 'live',
            Image.id != exclude_image_id,
            Image.captured_at >= cutoff_naive,
            Detection.category == 'person',
        )
    ).all()
    per_image: Dict[int, float] = {}
    for image_id, bbox in rows:
        area = bbox_area(bbox)
        if area is None:
            continue
        per_image[image_id] = max(per_image.get(image_id, 0.0), area)
    return list(per_image.values())


def _notify_person(
    email_queue: RedisQueue,
    telegram_queue: RedisQueue,
    db,
    rule: TheftWatchRule,
    user: User,
    project: Project,
    event: Dict[str, Any],
    captured_at: Optional[datetime],
    site_id: Optional[int],
    site_name: Optional[str],
    area: float,
    threshold: Optional[float],
    history_n: int,
) -> bool:
    """One message per configured channel. Returns True when at least one
    channel actually queued a message."""
    site_label = site_name or event.get('camera_name') or "Unknown"
    if captured_at:
        time_str = captured_at.strftime('%H:%M:%S')
        date_str = captured_at.strftime('%a, %d %b %Y')
    else:
        time_str = "Unknown"
        date_str = "Unknown"

    domain = settings.domain_name or "localhost:3000"
    images_url = images_link(domain, project.id, 'person', site_id)
    settings_url = f"https://{domain}/projects/{project.id}/notifications"

    # Rare-site cameras alert on any person, busy ones only on unusually
    # close people; say which case this was so the reader can judge
    if threshold is None:
        reason = "People are rarely seen by this camera."
    else:
        reason = "The person is unusually close for this camera."

    trigger_data = {
        "rule_id": rule.id,
        "trigger": "person",
        "project_id": project.id,
        "image_uuid": event.get('image_uuid'),
        "camera_id": event.get('camera_id'),
        "site": site_label,
        "sensitivity": rule.sensitivity,
        "area": round(area, 4),
        "threshold": round(threshold, 4) if threshold is not None else None,
        "history_n": history_n,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    queued = 0

    if "email" in rule.channels:
        if not user.email:
            logger.warning("Skipping email channel; user has no email", rule_id=rule.id)
        else:
            subject = f"{project.name}: person close to the camera at {site_label}"
            html_content, _ = render_email(
                "theft_watch_person.html",
                project_name=project.name,
                site_label=site_label,
                time_label=time_str,
                date_label=date_str,
                reason=reason,
                images_url=images_url,
                settings_url=settings_url,
            )
            text_content = "\n".join([
                f"{project.name} - theft watch (beta)",
                "=" * 50,
                "",
                f"A person was detected at {site_label}.",
                reason,
                f"Time: {time_str}",
                f"Date: {date_str}",
                "",
                "Theft watch is in beta. It can miss real events and it can",
                "raise false alarms. Please check the image before acting.",
                "",
                "-" * 50,
                f"View images: {images_url}",
                f"Manage rules: {settings_url}",
                "",
                "AddaxAI Connect - Camera trap image processing",
            ])
            log_id = create_notification_log(
                user_id=user.id,
                notification_type="theft_watch_person",
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
            logger.info("Queued theft watch person email", rule_id=rule.id, log_id=log_id)

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
            message_content = "\n".join([
                "*Theft watch (beta)*",
                f"A person was detected at {site_label}.",
                reason,
                f"*Time:* {time_str}",
                f"*Date:* {date_str}",
                f"*Project:* {project.name}",
            ])
            buttons_row = []
            location = event.get('camera_location')
            if location and location.get('lat') and location.get('lon'):
                buttons_row.append({
                    'text': 'Show on map',
                    'url': f"https://maps.google.com/?q={location['lat']},{location['lon']}",
                })
            buttons_row.append({'text': 'View images', 'url': images_url})

            log_id = create_notification_log(
                user_id=user.id,
                notification_type="theft_watch_person",
                channel="telegram",
                trigger_data=trigger_data,
                message_content=message_content,
            )
            telegram_queue.publish({
                "notification_log_id": log_id,
                "chat_id": chat_id,
                "message_text": message_content,
                "annotated_minio_path": event.get('annotated_minio_path'),
                "reply_markup": {"inline_keyboard": [buttons_row]},
            })
            queued += 1
            logger.info("Queued theft watch person telegram", rule_id=rule.id, log_id=log_id)

    return queued > 0


# ---- silence trigger, hourly job ----

def check_theft_watch_silence() -> None:
    """Scheduled job. Evaluate the silence trigger of every active theft
    watch rule and notify creators about cameras newly quieter than
    their own rhythm."""
    logger.info("Starting theft watch silence check")

    with get_sync_session() as db:
        now_utc = datetime.now(timezone.utc)
        today = now_utc.date()

        rows = list(db.execute(
            select(
                TheftWatchRule, User, Project,
                ProjectMembership.role, ProjectMembership.site_ids,
            )
            .join(User, TheftWatchRule.created_by_user_id == User.id)
            .join(Project, TheftWatchRule.project_id == Project.id)
            .outerjoin(
                ProjectMembership,
                (ProjectMembership.user_id == User.id)
                & (ProjectMembership.project_id == TheftWatchRule.project_id),
            )
            .where(
                TheftWatchRule.is_active == True,
                User.is_active == True,
                User.is_verified == True,
            )
            .order_by(TheftWatchRule.project_id.asc(), TheftWatchRule.id.asc())
        ).all())
        if not rows:
            logger.info("No active theft watch rules")
            return

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
        state_cache: Dict[int, Dict[int, WatchCamState]] = {}
        fired = 0
        failed = 0

        for rule, user, project, membership_role, membership_site_ids in rows:
            try:
                if membership_role is None and not user.is_superuser:
                    logger.warning(
                        "Skipping theft watch rule; creator has no project membership",
                        rule_id=rule.id,
                        user_id=user.id,
                    )
                    continue

                if project.id not in state_cache:
                    state_cache[project.id] = _load_watch_states(db, project.id, now_utc)
                states = state_cache[project.id]

                site_scope = effective_site_scope(
                    membership_role, membership_site_ids, rule.site_ids,
                )
                offending = _offending_cameras(rule, states, site_scope, today)
                new, ongoing, recovered = split_incidents(
                    offending, rule.notified_camera_ids
                )

                delivered = False
                if new:
                    delivered = _notify_silence(
                        email_queue, telegram_queue, db,
                        rule, user, project, states, new, offending,
                    )
                    if delivered:
                        fired += 1
                    else:
                        logger.warning(
                            "Theft watch silence fired but no channel delivered",
                            rule_id=rule.id,
                            new_camera_ids=new,
                        )

                next_state = next_notified_state(new, ongoing, delivered)
                if next_state != sorted(rule.notified_camera_ids or []):
                    rule.notified_camera_ids = next_state

            except Exception as exc:
                logger.error(
                    "Failed to process theft watch rule",
                    rule_id=rule.id,
                    project_id=project.id,
                    error=str(exc),
                    exc_info=True,
                )
                failed += 1
                continue

        db.commit()

        logger.info(
            "Theft watch silence check complete",
            total=len(rows),
            fired=fired,
            failed=failed,
        )


def _offending_cameras(
    rule: TheftWatchRule,
    states: Dict[int, WatchCamState],
    site_scope: Optional[List[int]],
    today: date,
) -> List[int]:
    """Camera ids currently quieter than their own rhythm, within the
    rule's clamped site scope. Cameras in warm-up, without enough gap
    history, or never heard from are skipped."""
    result = []
    for camera_id, state in states.items():
        if site_scope is not None:
            if state.site_id is None or state.site_id not in site_scope:
                continue
        if in_warmup(state.dep_start, today):
            continue
        if state.last_contact is None:
            continue
        threshold = silence_threshold_hours(state.gap_hours, rule.sensitivity)
        if threshold is None:
            continue
        if state.silence_hours > threshold:
            result.append(camera_id)
    return sorted(result)


def _load_watch_states(
    db, project_id: int, now_utc: datetime
) -> Dict[int, WatchCamState]:
    """One state entry per camera of the project: current deployment and
    site, coordinates, battery, and the contact rhythm of the recent
    weeks (live image arrivals plus health report arrivals, server
    receive times)."""
    states: Dict[int, WatchCamState] = {}
    for row in db.execute(
        select(Camera.id, Camera.device_id, Camera.config)
        .where(Camera.project_id == project_id)
    ).all():
        battery = None
        if isinstance(row.config, dict):
            battery = (row.config.get('last_health_report') or {}).get('battery_percentage')
        states[row.id] = WatchCamState(
            device_id=row.device_id,
            site_id=None,
            site_name=None,
            lat=None,
            lon=None,
            dep_start=None,
            battery_percent=battery,
            last_contact=None,
            gap_hours=[],
            silence_hours=0.0,
        )
    if not states:
        return states

    # Current (active, else latest) deployment with its site and pin,
    # same resolution as get_camera_site_label
    for row in db.execute(
        text("""
            SELECT DISTINCT ON (d.camera_id)
                   d.camera_id, d.start_date, d.site_id, s.name AS site_name,
                   ST_Y(s.location::geometry) AS lat,
                   ST_X(s.location::geometry) AS lon
            FROM deployments d
            JOIN cameras c ON c.id = d.camera_id
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE c.project_id = :project_id
            ORDER BY d.camera_id, (d.end_date IS NULL) DESC, d.start_date DESC
        """),
        {"project_id": project_id},
    ).all():
        state = states.get(row.camera_id)
        if state is None:
            continue
        state.dep_start = row.start_date
        state.site_id = row.site_id
        state.site_name = row.site_name
        state.lat = row.lat
        state.lon = row.lon

    cutoff = now_utc - timedelta(days=CONTACT_HISTORY_DAYS)
    contacts: Dict[int, List[datetime]] = {camera_id: [] for camera_id in states}
    for row in db.execute(
        select(Image.camera_id, Image.ingested_at)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            Camera.project_id == project_id,
            Image.origin == 'live',
            Image.ingested_at >= cutoff,
        )
    ).all():
        contacts[row.camera_id].append(row.ingested_at)
    for row in db.execute(
        select(CameraHealthReport.camera_id, CameraHealthReport.created_at)
        .join(Camera, CameraHealthReport.camera_id == Camera.id)
        .where(
            Camera.project_id == project_id,
            CameraHealthReport.created_at >= cutoff,
        )
    ).all():
        contacts[row.camera_id].append(row.created_at)

    for camera_id, stamps in contacts.items():
        if not stamps:
            continue
        stamps.sort()
        state = states[camera_id]
        state.last_contact = stamps[-1]
        state.gap_hours = contact_gap_hours(stamps)
        state.silence_hours = (now_utc - stamps[-1]).total_seconds() / 3600.0

    return states


def _silence_lines(
    states: Dict[int, WatchCamState],
    new_camera_ids: List[int],
    offending: List[int],
) -> List[Dict[str, str]]:
    lines = []
    for camera_id in new_camera_ids:
        state = states[camera_id]
        last_label = (
            state.last_contact.strftime('%b %d, %H:%M')
            if state.last_contact else "unknown"
        )
        value_label = f"last heard {last_label}"
        if state.battery_percent is not None:
            value_label += f", battery was {state.battery_percent}%"
        nearby = nearby_silent_count(camera_id, offending, states)
        if nearby is None:
            nearby_label = ""
        elif nearby == 0:
            nearby_label = "No other nearby cameras are silent."
        else:
            nearby_label = (
                f"{nearby} other nearby camera{'s are' if nearby != 1 else ' is'}"
                " also silent."
            )
        lines.append({
            "name": state.device_id or f"Camera {camera_id}",
            "site": state.site_name or "No site",
            "value_label": value_label,
            "nearby_label": nearby_label,
        })
    return lines


def _notify_silence(
    email_queue: RedisQueue,
    telegram_queue: RedisQueue,
    db,
    rule: TheftWatchRule,
    user: User,
    project: Project,
    states: Dict[int, WatchCamState],
    new_camera_ids: List[int],
    offending: List[int],
) -> bool:
    """One message per configured channel listing the newly silent
    cameras. Returns True when at least one channel actually queued."""
    domain = settings.domain_name or "localhost:3000"
    cameras_url = f"https://{domain}/projects/{project.id}/cameras"
    settings_url = f"https://{domain}/projects/{project.id}/notifications"

    cameras = _silence_lines(states, new_camera_ids, offending)
    count = len(cameras)

    trigger_data = {
        "rule_id": rule.id,
        "trigger": "silence",
        "project_id": project.id,
        "sensitivity": rule.sensitivity,
        "camera_ids": new_camera_ids,
        "details": {
            str(camera_id): {
                "silence_hours": round(states[camera_id].silence_hours, 1),
                "threshold_hours": silence_threshold_hours(
                    states[camera_id].gap_hours, rule.sensitivity
                ),
            }
            for camera_id in new_camera_ids
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    subject = (
        f"{project.name}: {count} camera{'s' if count != 1 else ''}"
        " unusually silent"
    )
    text_lines = [
        f"{project.name} - theft watch (beta)",
        "=" * 50,
        "",
        f"{count} camera{'s have' if count != 1 else ' has'} been silent for"
        " longer than usual.",
        "",
    ]
    for cam in cameras:
        text_lines.append(f"- {cam['site']} - {cam['name']}: {cam['value_label']}")
        if cam['nearby_label']:
            text_lines.append(f"  {cam['nearby_label']}")
    text_lines += [
        "",
        "Theft watch is in beta. A silent camera can also mean an empty",
        "battery, a full SD card, or bad signal. Please check on site.",
        "",
        "-" * 50,
        f"View cameras: {cameras_url}",
        f"Manage rules: {settings_url}",
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
                "theft_watch_silence.html",
                project_name=project.name,
                camera_count=count,
                cameras=cameras,
                cameras_url=cameras_url,
                settings_url=settings_url,
            )
            log_id = create_notification_log(
                user_id=user.id,
                notification_type="theft_watch_silence",
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
            logger.info("Queued theft watch silence email", rule_id=rule.id, log_id=log_id)

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
                "*Theft watch (beta)*",
                f"*{project.name}*",
                f"{count} camera{'s have' if count != 1 else ' has'} been"
                " silent for longer than usual.",
                "",
            ]
            for cam in cameras:
                message_lines.append(f"- {cam['site']} - {cam['name']}: {cam['value_label']}")
                if cam['nearby_label']:
                    message_lines.append(f"  {cam['nearby_label']}")
            message_text = "\n".join(message_lines)

            log_id = create_notification_log(
                user_id=user.id,
                notification_type="theft_watch_silence",
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
            logger.info("Queued theft watch silence telegram", rule_id=rule.id, log_id=log_id)

    return queued > 0
