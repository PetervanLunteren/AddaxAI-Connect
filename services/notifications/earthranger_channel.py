"""
The earthranger delivery channel, shared by every rule type.

Email and Telegram reach the rule's creator. EarthRanger reaches the
project's ranger team through Gundi, so the channel is keyed on the
project's integration row, not on the user. Each notify function builds
its event with shared.earthranger and hands it here; this module writes
the notification log row and queues the message for the
notifications-earthranger worker, which posts it and attaches the image.

Nothing here talks to Gundi. Like the other channels, the coordinator
only queues, so a slow or failing Gundi never delays the live event
loop, and the worker's retry is the queue's retry.
"""
import json
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import select, text

from shared.logger import get_logger
from shared.models import ProjectIntegration, SpeciesTaxonomy
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EARTHRANGER

from db_operations import create_notification_log

logger = get_logger("notifications.earthranger_channel")

CHANNEL = "earthranger"

_queue: Optional[RedisQueue] = None


def get_queue() -> RedisQueue:
    """One queue handle per process, made on first use so importing this
    module never touches Redis."""
    global _queue
    if _queue is None:
        _queue = RedisQueue(QUEUE_NOTIFICATION_EARTHRANGER)
    return _queue


def enabled_integration(db, project_id: int) -> Optional[ProjectIntegration]:
    return db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == CHANNEL,
            ProjectIntegration.is_enabled == True,
        )
    ).scalar_one_or_none()


def site_location(db, site_id: Optional[int]) -> Tuple[Optional[float], Optional[float]]:
    """Coordinates of a site, (None, None) without one."""
    if site_id is None:
        return None, None
    row = db.execute(
        text("""
            SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
            FROM sites WHERE id = :site_id
        """),
        {"site_id": site_id},
    ).first()
    if not row:
        return None, None
    return row.lat, row.lon


def camera_site(db, camera_id: int) -> Tuple[Optional[str], Optional[float], Optional[float]]:
    """Name and coordinates of the site a camera currently stands at, via
    its active (or latest) deployment. Same lookup as get_camera_site_label,
    plus the coordinates the event needs."""
    row = db.execute(
        text("""
            SELECT s.name AS site_name,
                   ST_Y(s.location::geometry) AS lat,
                   ST_X(s.location::geometry) AS lon
            FROM deployments d
            JOIN sites s ON s.id = d.site_id
            WHERE d.camera_id = :camera_id
            ORDER BY (d.end_date IS NULL) DESC, d.start_date DESC
            LIMIT 1
        """),
        {"camera_id": camera_id},
    ).first()
    if not row:
        return None, None, None
    return row.site_name, row.lat, row.lon


def scientific_name(db, species: str) -> Optional[str]:
    """The taxonomy table's scientific name for a label, or None."""
    return db.execute(
        select(SpeciesTaxonomy.scientific_name).where(
            SpeciesTaxonomy.common_name == species
        )
    ).scalar_one_or_none()


def image_link(domain: str, project_id: int, image_uuid: str) -> str:
    """Deep link that opens one image on the images page."""
    return f"https://{domain}/projects/{project_id}/images?image={image_uuid}"


def queue_event(
    db,
    *,
    project_id: int,
    rule_id: int,
    user_id: int,
    notification_type: str,
    trigger_data: Dict[str, Any],
    event: Dict[str, Any],
    attachment_minio_path: Optional[str] = None,
) -> bool:
    """Log and queue one event. False when the project has no enabled
    EarthRanger integration, so the caller does not count the channel as
    delivered (the same contract as a Telegram rule without a linked chat).
    """
    if enabled_integration(db, project_id) is None:
        logger.warning(
            "Skipping earthranger channel; integration not enabled",
            rule_id=rule_id,
            project_id=project_id,
        )
        return False

    log_id = create_notification_log(
        user_id=user_id,
        notification_type=notification_type,
        channel=CHANNEL,
        trigger_data=trigger_data,
        message_content=json.dumps(event)[:1000],
    )
    get_queue().publish({
        "notification_log_id": log_id,
        "project_id": project_id,
        "event": event,
        "attachment_minio_path": attachment_minio_path,
    })
    logger.info(
        "Queued earthranger event",
        rule_id=rule_id,
        log_id=log_id,
        event_type=event.get("event_type"),
    )
    return True
