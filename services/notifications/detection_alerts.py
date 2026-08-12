"""
Detection alert rules — live event path evaluation.

Each row in `detection_alert_rules` is a private, user-created rule: a set
of labels (species plus person/vehicle), optionally narrowed by site, time
of day, minimum group size, a cooldown, and a rarity lookback, delivered
by email and/or Telegram. Every `species_detection` event from the
classifiers is evaluated against the active rules of its project; each
matching rule sends its creator one message per configured channel.

Two project-level gates are applied once per event before any rule runs,
preserved from the retired rule engine: the detection confidence must
reach the project's detection threshold, and the classification
confidence must reach the project's per-species threshold, so alerts
never fire for detections hidden from every other view.

Cooldown is keyed per species and site. A rule only counts as having
alerted (and only stamps its cooldown) when at least one channel actually
queued a message; a telegram-only rule without a linked chat must not
swallow alerts silently. Queue publishes happen before the state commit,
so a crash duplicates a message rather than losing one.

The cooldown state write on this live path can race a concurrent rule
edit through the API (both replace the JSON column, last writer wins).
Worst case is one duplicate message right after an edit, the same
accepted trade-off as the camera condition alerts.

The hour window uses the camera capture time (animals live by local
time), half-open [from, to), wrapping past midnight when from is later
than to, exactly like the images page filter. Rarity is a stateless
lookback over already-committed classification rows on camera capture
time, project-wide, where an AI detection above the thresholds counts as
seen; the triggering image is excluded by id.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from sqlalchemy import select

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.classification_threshold import (
    classification_passes_threshold,
    effective_classification_threshold,
)
from shared.models import (
    Camera,
    Classification,
    Deployment,
    Detection,
    DetectionAlertRule,
    Image,
    Project,
    ProjectMembership,
    ProjectNotificationPreference,
    Site,
    User,
)
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings
from shared.email_renderer import render_email

from db_operations import create_notification_log
from text_format import md_escape

logger = get_logger("notifications.detection_alerts")
settings = get_settings()

# Detection-level labels without classification rows; the rarity lookback
# matches these on Detection.category instead of Classification.species
DETECTION_LEVEL_LABELS = ("person", "vehicle")


@dataclass
class EventFacts:
    """Everything a rule needs to know about one event, resolved once."""
    species: str
    site_id: Optional[int]
    capture_hour: Optional[int]  # from Image.captured_at, camera clock
    species_count: Optional[int]  # per-species count from the producer
    detection_count: Optional[int]  # all detections in the image, fallback


def hour_in_window(hour: int, hour_from: int, hour_to: int) -> bool:
    """Half-open [from, to) on the capture hour, wrapping past midnight
    when from is later than to (21 to 5 is the night). Equal bounds never
    reach this function, the API rejects them."""
    if hour_from < hour_to:
        return hour_from <= hour < hour_to
    return hour >= hour_from or hour < hour_to


def group_size_met(
    species_count: Optional[int], detection_count: Optional[int], minimum: int
) -> bool:
    """Prefer the producer's per-species count; fall back to the whole
    image count for events queued before the producers learned the field.
    No count at all fails closed, the condition exists to suppress."""
    count = species_count if species_count is not None else detection_count
    return count is not None and count >= minimum


def cooldown_key(species: str, site_id: Optional[int]) -> str:
    return f"{species}|{site_id if site_id is not None else 'none'}"


def cooldown_active(
    state: Optional[Dict[str, str]], key: str, cooldown_minutes: int, now: datetime
) -> bool:
    """True when the rule delivered for this key within the cooldown."""
    stamp = (state or {}).get(key)
    if not stamp:
        return False
    try:
        last = datetime.fromisoformat(stamp)
    except ValueError:
        return False
    return now - last < timedelta(minutes=cooldown_minutes)


def next_cooldown_state(
    state: Optional[Dict[str, str]], key: str, now: datetime, cooldown_minutes: int
) -> Dict[str, str]:
    """The cooldown_state to store after a delivery: the key stamped with
    now, expired entries pruned (they can never suppress anything, so the
    map stays small). Always a new dict, never a mutation, so SQLAlchemy
    change tracking fires."""
    horizon = now - timedelta(minutes=cooldown_minutes)
    fresh = {}
    for other_key, stamp in (state or {}).items():
        try:
            last = datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if last > horizon:
            fresh[other_key] = stamp
    fresh[key] = now.isoformat()
    return fresh


def effective_site_scope(
    membership_role: Optional[str],
    membership_site_ids: Optional[List[int]],
    rule_site_ids: Optional[List[int]],
) -> Optional[List[int]]:
    """The site scope a rule is actually evaluated with.

    Admins, unscoped viewers, and server admins without a membership row
    (membership_role None) keep the rule's own scope. A site-restricted
    viewer's rule is intersected with their allow-list, and a null rule
    scope (all sites) becomes the allow-list itself, so rules created
    before a restriction cannot leak. An empty result means the rule can
    never match.
    """
    if membership_role != 'project-viewer' or membership_site_ids is None:
        return rule_site_ids
    if rule_site_ids is None:
        return list(membership_site_ids)
    allowed = set(membership_site_ids)
    return [s for s in rule_site_ids if s in allowed]


def rule_matches(
    rule: DetectionAlertRule,
    facts: EventFacts,
    site_scope: Optional[List[int]],
) -> bool:
    """Species membership, site scope, hour window, and group size.
    Cooldown and rarity are checked separately, they need time and DB.

    site_scope is the clamped scope from effective_site_scope, not the
    rule's raw site_ids. A site-less image never matches a scoped rule
    (but still reaches rules without a scope). A rule with an hour window
    fails closed when the capture hour is unknown, the window exists to
    suppress."""
    if facts.species not in (rule.species or []):
        return False
    if site_scope is not None:
        if facts.site_id is None or facts.site_id not in site_scope:
            return False
    if rule.hour_from is not None and rule.hour_to is not None:
        if facts.capture_hour is None:
            return False
        if not hour_in_window(facts.capture_hour, rule.hour_from, rule.hour_to):
            return False
    if rule.min_group_size is not None:
        if not group_size_met(facts.species_count, facts.detection_count, rule.min_group_size):
            return False
    return True


def species_display_name(species: str) -> str:
    return species.replace('_', ' ').capitalize()


def images_link(domain: str, project_id: int, species: str, site_id: Optional[int]) -> str:
    """Deep link to the images page filtered to the alert's species (and
    site when the image has one), so the reader lands on the pictures
    that triggered the alert instead of the unfiltered wall. The filter
    format matches the images page URL schema, comma-separated values in
    one query parameter per filter."""
    url = f"https://{domain}/projects/{project_id}/images?species={quote(species)}"
    if site_id is not None:
        url += f"&site_id={site_id}"
    return url


def _load_event_image(
    db, image_uuid: str
) -> Optional[Tuple[int, datetime, Optional[int], Optional[str]]]:
    """One query for everything image-related a rule needs: the image id
    (rarity exclusion), captured_at (hour window and rarity bounds), and
    the site id and name via the deployment (scope and message)."""
    row = db.execute(
        select(Image.id, Image.captured_at, Deployment.site_id, Site.name)
        .outerjoin(Deployment, Image.deployment_id == Deployment.id)
        .outerjoin(Site, Deployment.site_id == Site.id)
        .where(Image.uuid == image_uuid)
    ).first()
    if not row:
        return None
    return row.id, row.captured_at, row.site_id, row.name


def _load_rules(
    db, project_id: int
) -> List[Tuple[DetectionAlertRule, User, Optional[str], Optional[List[int]]]]:
    """Active rules with their creator and the creator's membership (role,
    site_ids). Rules whose creator has no membership are dropped, unless
    the creator is a server admin, who has implicit access to every
    project and no membership row."""
    rows = db.execute(
        select(
            DetectionAlertRule,
            User,
            ProjectMembership.role,
            ProjectMembership.site_ids,
        )
        .join(User, DetectionAlertRule.created_by_user_id == User.id)
        .outerjoin(
            ProjectMembership,
            (ProjectMembership.user_id == User.id)
            & (ProjectMembership.project_id == DetectionAlertRule.project_id),
        )
        .where(
            DetectionAlertRule.project_id == project_id,
            DetectionAlertRule.is_active == True,
            User.is_active == True,
            User.is_verified == True,
        )
        .order_by(DetectionAlertRule.id.asc())
    ).all()

    kept = []
    for rule, user, role, membership_site_ids in rows:
        if role is None and not user.is_superuser:
            logger.warning(
                "Skipping detection rule; creator has no project membership",
                rule_id=rule.id,
                user_id=user.id,
            )
            continue
        kept.append((rule, user, role, membership_site_ids))
    return kept


def species_seen_in_lookback(
    db,
    project_id: int,
    species: str,
    since: datetime,
    until: datetime,
    exclude_image_id: int,
) -> bool:
    """Whether the species was seen in the project inside [since, until),
    on camera capture time, excluding the triggering image. An AI result
    counts as seen when it passes the same thresholds every other view
    applies. Person/vehicle have no classification rows and match on the
    detection category instead."""
    if species in DETECTION_LEVEL_LABELS:
        query = (
            select(Detection.id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                Camera.project_id == project_id,
                Detection.category == species,
                Detection.confidence >= Project.detection_threshold,
                Image.captured_at >= since,
                Image.captured_at < until,
                Image.id != exclude_image_id,
            )
            .limit(1)
        )
    else:
        query = (
            select(Classification.id)
            .join(Detection, Classification.detection_id == Detection.id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                Camera.project_id == project_id,
                Classification.species == species,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
                Image.captured_at >= since,
                Image.captured_at < until,
                Image.id != exclude_image_id,
            )
            .limit(1)
        )
    return db.execute(query).first() is not None


def handle_detection_event(event: Dict[str, Any]) -> None:
    """Evaluate one species_detection event against the active detection
    alert rules of its project and queue one message per matching rule
    and configured channel."""
    image_uuid = event.get('image_uuid')
    species = event.get('species')
    project_id = event.get('project_id')

    if not all([image_uuid, species, project_id]):
        logger.error("Missing required fields in species_detection event", event=event)
        return

    with get_sync_session() as db:
        project = db.get(Project, project_id)
        if not project:
            logger.error("Project not found", project_id=project_id)
            return

        # Project-level gates, preserved from the retired rule engine.
        # detection_confidence is MegaDetector, confidence is the
        # classification (for person/vehicle both carry the detection value).
        detection_confidence = event.get('detection_confidence', event.get('confidence'))
        if detection_confidence is None:
            logger.warning("Missing confidence in species_detection event", event=event)
            return
        if detection_confidence < project.detection_threshold:
            logger.debug(
                "Detection below project threshold, skipping",
                confidence=detection_confidence,
                threshold=project.detection_threshold,
                species=species,
            )
            return
        classification_confidence = event.get('confidence')
        if classification_confidence is not None:
            cls_threshold = effective_classification_threshold(
                project.classification_thresholds, species,
            )
            if classification_confidence < cls_threshold:
                logger.debug(
                    "Classification below per-species threshold, skipping",
                    classification_confidence=classification_confidence,
                    threshold=cls_threshold,
                    species=species,
                )
                return

        loaded = _load_event_image(db, image_uuid)
        if loaded is None:
            logger.error("Image not found for event", image_uuid=image_uuid)
            return
        image_id, captured_at, site_id, site_name = loaded

        facts = EventFacts(
            species=species,
            site_id=site_id,
            capture_hour=captured_at.hour if captured_at else None,
            species_count=event.get('species_count'),
            detection_count=event.get('detection_count'),
        )

        rows = _load_rules(db, project_id)
        if not rows:
            return

        email_queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)
        telegram_queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)
        now_utc = datetime.now(timezone.utc)
        key = cooldown_key(species, site_id)
        # Rarity depends only on the lookback length within one event
        rarity_cache: Dict[int, bool] = {}
        fired = 0

        for rule, user, membership_role, membership_site_ids in rows:
            try:
                # Membership presence was already checked in _load_rules;
                # clamp the rule to the creator's site allow-list
                site_scope = effective_site_scope(
                    membership_role, membership_site_ids, rule.site_ids,
                )
                if not rule_matches(rule, facts, site_scope):
                    continue

                if rule.cooldown_minutes and cooldown_active(
                    rule.cooldown_state, key, rule.cooldown_minutes, now_utc
                ):
                    logger.debug("Rule in cooldown", rule_id=rule.id, key=key)
                    continue

                if rule.rarity_days:
                    if captured_at is None:
                        # No capture time, the lookback has no anchor; the
                        # condition exists to suppress, so fail closed
                        logger.warning(
                            "Rarity rule skipped; image has no capture time",
                            rule_id=rule.id,
                            image_uuid=image_uuid,
                        )
                        continue
                    if rule.rarity_days not in rarity_cache:
                        rarity_cache[rule.rarity_days] = species_seen_in_lookback(
                            db, project.id, species,
                            captured_at - timedelta(days=rule.rarity_days),
                            captured_at, image_id,
                        )
                    if rarity_cache[rule.rarity_days]:
                        logger.debug(
                            "Species seen inside lookback, rule quiet",
                            rule_id=rule.id,
                            rarity_days=rule.rarity_days,
                        )
                        continue

                delivered = _notify_rule(
                    email_queue, telegram_queue, db,
                    rule, user, project, event, captured_at, site_id, site_name,
                )
                if delivered:
                    fired += 1
                    if rule.cooldown_minutes:
                        rule.cooldown_state = next_cooldown_state(
                            rule.cooldown_state, key, now_utc, rule.cooldown_minutes,
                        )
                else:
                    logger.warning(
                        "Detection rule matched but no channel delivered",
                        rule_id=rule.id,
                        user_id=user.id,
                    )
            except Exception as exc:
                logger.error(
                    "Failed to process detection rule",
                    rule_id=rule.id,
                    error=str(exc),
                    exc_info=True,
                )
                continue

        db.commit()

        logger.info(
            "Detection alert evaluation complete",
            species=species,
            image_uuid=image_uuid,
            rules=len(rows),
            fired=fired,
        )


def _notify_rule(
    email_queue: RedisQueue,
    telegram_queue: RedisQueue,
    db,
    rule: DetectionAlertRule,
    user: User,
    project: Project,
    event: Dict[str, Any],
    captured_at: Optional[datetime],
    site_id: Optional[int],
    site_name: Optional[str],
) -> bool:
    """Send one message per configured channel for a matched rule.
    Returns True when at least one channel actually queued a message."""
    species = event['species']
    species_display = species_display_name(species)
    # Lead with where (site), fall back to the camera name only when the
    # image has no resolved site
    site_label = site_name or event.get('camera_name') or "Unknown"

    if captured_at:
        time_str = captured_at.strftime('%H:%M:%S')
        date_str = captured_at.strftime('%a, %d %b %Y')
    else:
        time_str = "Unknown"
        date_str = "Unknown"

    domain = settings.domain_name or "localhost:3000"
    images_url = images_link(domain, project.id, species, site_id)
    settings_url = f"https://{domain}/projects/{project.id}/notifications"

    count = event.get('species_count', event.get('detection_count'))
    confidence = event.get('confidence')

    trigger_data = {
        "rule_id": rule.id,
        "project_id": project.id,
        "image_uuid": event.get('image_uuid'),
        "species": species,
        "site": site_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    queued = 0

    if "email" in rule.channels:
        if not user.email:
            logger.warning("Skipping email channel; user has no email", rule_id=rule.id)
        else:
            subject = f"{project.name}: {species_display} detected at {site_label}"
            html_content, _ = render_email(
                "detection_alert.html",
                project_name=project.name,
                species_display=species_display,
                site_label=site_label,
                time_label=time_str,
                date_label=date_str,
                confidence_label=f"{round(confidence * 100)}%" if confidence is not None else None,
                count=count,
                images_url=images_url,
                settings_url=settings_url,
            )
            text_lines = [
                f"{project.name} - detection alert",
                "=" * 50,
                "",
                f"{species_display} detected at {site_label}",
                f"Time: {time_str}",
                f"Date: {date_str}",
            ]
            if count:
                text_lines.append(f"Count: {count}")
            text_lines += [
                "",
                "-" * 50,
                f"View images: {images_url}",
                f"Manage alert rules: {settings_url}",
                "",
                "AddaxAI Connect - Camera trap image processing",
            ]
            text_content = "\n".join(text_lines)

            log_id = create_notification_log(
                user_id=user.id,
                notification_type="species_detection",
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
            logger.info("Queued detection alert email", rule_id=rule.id, log_id=log_id)

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
                f"*{md_escape(species_display)} detected!*",
                f"*Site:* {md_escape(site_label)}",
                f"*Time:* {time_str}",
                f"*Date:* {date_str}",
                f"*Project:* {md_escape(project.name)}",
            ]
            message_content = "\n".join(message_lines)

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
                notification_type="species_detection",
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
            logger.info("Queued detection alert telegram", rule_id=rule.id, log_id=log_id)

    return queued > 0
