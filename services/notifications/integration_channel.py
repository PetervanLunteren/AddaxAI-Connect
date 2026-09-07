"""
The project channels' delivery side, shared by every rule type.

Email and Telegram reach the rule's creator. A project channel reaches the
project's integration, an EarthRanger site through Gundi or a Sensing
Clues group through Central, so it is keyed on the project's integration
row, not on the user. Each notify function gathers the facts of the alert
and hands them here; this module builds the vendor payload, writes the
notification log row and queues the message for the kind's delivery
worker, which posts it and attaches the image.

Nothing here talks to a vendor. Like the other channels, the coordinator
only queues, so a slow or failing platform never delays the live event
loop, and the worker's retry is the queue's retry.
"""
import json
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import select, text

from shared.classification_models import model_info
from shared.earthranger import build_camera_event, build_detection_event
from shared.logger import get_logger
from shared.models import ProjectIntegration, SpeciesTaxonomy
from shared.project_channels import EARTHRANGER, SENSINGCLUES, project_channel_of  # noqa: F401  (re-exported)
from shared.queue import (
    RedisQueue,
    QUEUE_NOTIFICATION_EARTHRANGER,
    QUEUE_NOTIFICATION_SENSINGCLUES,
)
from shared.sensingclues import (
    build_camera_observation,
    build_detection_observation,
    new_observation_id,
)

from db_operations import create_notification_log

logger = get_logger("notifications.integration_channel")

QUEUES = {
    EARTHRANGER: QUEUE_NOTIFICATION_EARTHRANGER,
    SENSINGCLUES: QUEUE_NOTIFICATION_SENSINGCLUES,
}

_queues: Dict[str, RedisQueue] = {}


def get_queue(kind: str) -> RedisQueue:
    """One queue handle per kind per process, made on first use so
    importing this module never touches Redis. An unknown kind is a
    KeyError on purpose: nothing may queue for a worker that does not exist."""
    if kind not in _queues:
        _queues[kind] = RedisQueue(QUEUES[kind])
    return _queues[kind]


def enabled_integration(db, kind: str, project_id: int) -> Optional[ProjectIntegration]:
    return db.execute(
        select(ProjectIntegration).where(
            ProjectIntegration.project_id == project_id,
            ProjectIntegration.kind == kind,
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
    plus the coordinates the payload needs."""
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


def build_detection_payload(
    kind: str, facts: Dict[str, Any], classification_model: Optional[str]
) -> Dict[str, Any]:
    """The kind's detection payload from one set of facts, the keyword
    arguments both vendor builders share. Raises ValueError without a
    location, so the caller skips the channel and logs why."""
    if kind == EARTHRANGER:
        return build_detection_event(**facts)
    if kind == SENSINGCLUES:
        return build_detection_observation(
            observation_id=new_observation_id(),
            classifier=model_info(classification_model)["name"],
            **facts,
        )
    raise KeyError(kind)


def build_camera_payload(kind: str, facts: Dict[str, Any]) -> Dict[str, Any]:
    """The kind's camera alert payload (camera condition and theft watch
    alike) from one set of facts."""
    if kind == EARTHRANGER:
        return build_camera_event(**facts)
    if kind == SENSINGCLUES:
        return build_camera_observation(observation_id=new_observation_id(), **facts)
    raise KeyError(kind)


def queue_event(
    db,
    *,
    kind: str,
    project_id: int,
    rule_id: int,
    user_id: int,
    notification_type: str,
    trigger_data: Dict[str, Any],
    event: Dict[str, Any],
    attachment_minio_path: Optional[str] = None,
) -> bool:
    """Log and queue one vendor payload for the kind's delivery worker.
    False when the project has no enabled integration of that kind, so the
    caller does not count the channel as delivered (the same contract as a
    Telegram rule without a linked chat).
    """
    if enabled_integration(db, kind, project_id) is None:
        logger.warning(
            "Skipping project channel; integration not enabled",
            kind=kind,
            rule_id=rule_id,
            project_id=project_id,
        )
        return False

    log_id = create_notification_log(
        user_id=user_id,
        notification_type=notification_type,
        channel=kind,
        trigger_data=trigger_data,
        message_content=json.dumps(event)[:1000],
    )
    get_queue(kind).publish({
        "notification_log_id": log_id,
        "project_id": project_id,
        "event": event,
        "attachment_minio_path": attachment_minio_path,
    })
    logger.info(
        "Queued integration event",
        kind=kind,
        rule_id=rule_id,
        log_id=log_id,
    )
    return True
