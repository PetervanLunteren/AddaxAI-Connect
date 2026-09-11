"""
Sensing Clues notifications worker

Consumes QUEUE_NOTIFICATION_SENSINGCLUES and posts each observation into
the project's Cluey group with the account saved on that project, then
attaches a thumbnail of the annotated image.

One message is one observation. The coordinator already decided that the
rule matched and wrote the notification log row; this worker only
delivers and records the outcome, on the log row and on the project's
integration row (last_sent_at, events_sent, last_error, health_status) so
the integration page can show whether the connection works.

Like the email, Telegram and EarthRanger workers there is no retry: a
failed send is logged as failed with the reason and the message is
dropped. The observation id is ours, so a message the queue delivers
twice updates the same observation instead of making a second one.

The account is the project's own, read from its integration row per
message together with the group. So a client is built per observation and
its token lives only for that message: a changed account takes effect on
the next one, and nothing has to be restarted.

A development server needs no guard here: scripts/restore.sh deletes the
restored project_integrations rows on a dev box, so dev only holds
accounts someone saved there on purpose.
"""
from io import BytesIO
from typing import Any, Dict, Optional

from PIL import Image

from shared.logger import get_logger
from shared.queue import (
    RedisQueue,
    QUEUE_NOTIFICATION_SENSINGCLUES,
    HEARTBEAT_KEY_NOTIFICATIONS_SENSINGCLUES,
)
from shared.sensingclues import SensingCluesError, client_from_config, is_configured
from shared.storage import StorageClient, BUCKET_THUMBNAILS

from db_operations import (
    load_config,
    record_failure,
    record_success,
    update_notification_status,
)

logger = get_logger("notifications-sensingclues")

# Cluey wants a thumbnail of about 100 KB, not the 1280 px annotated image.
# Longest side 800 px at quality 80 lands there for a camera trap photo.
MAX_SIDE_PX = 800
JPEG_QUALITY = 80

NOT_SET_UP = "Sensing Clues is not set up for this project"


def downscale(data: bytes) -> bytes:
    """The attachment as a JPEG with the longest side at most MAX_SIDE_PX.
    A smaller image is re-encoded, never enlarged."""
    with Image.open(BytesIO(data)) as img:
        img = img.convert("RGB")
        img.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
        out = BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


def download_attachment(minio_path: str) -> Optional[bytes]:
    """The annotated image from the thumbnails bucket, or None when it is
    gone (they expire after a day) or storage is unreachable. The
    observation still goes out; an alert without a photo beats no alert."""
    try:
        return StorageClient().download_fileobj(BUCKET_THUMBNAILS, minio_path)
    except Exception as e:
        logger.warning("Attachment not available", path=minio_path, error=str(e))
        return None


def process_message(message: Dict[str, Any]) -> None:
    """
    Expected message structure:
    {
        'notification_log_id': int,
        'project_id': int,
        'event': dict,                          # Cluey observation payload
        'attachment_minio_path': str | None,    # key in the thumbnails bucket
    }
    """
    log_id = message.get('notification_log_id')
    project_id = message.get('project_id')
    observation = message.get('event')
    attachment_path = message.get('attachment_minio_path')

    if not log_id or not project_id or not isinstance(observation, dict):
        logger.error(
            "Invalid message format",
            has_log_id=log_id is not None,
            has_project_id=project_id is not None,
            has_event=isinstance(observation, dict),
        )
        return

    logger.info(
        "Processing sensingclues observation",
        log_id=log_id,
        project_id=project_id,
        observation_type=observation.get('observation_type'),
        has_attachment=attachment_path is not None,
    )

    config = load_config(project_id)
    if not is_configured(config):
        logger.warning(NOT_SET_UP, log_id=log_id, project_id=project_id)
        update_notification_status(log_id, 'failed', error_message=NOT_SET_UP)
        return

    # One client per message, from the project's own account. It logs in
    # once for this observation and its image, and keeps nothing after.
    client = client_from_config(config)
    try:
        alert_id = client.create_observation(config["group_id"], observation)
    except SensingCluesError as e:
        logger.error(
            "Failed to post sensingclues observation",
            log_id=log_id,
            project_id=project_id,
            status=e.status,
            error=str(e),
        )
        update_notification_status(log_id, 'failed', error_message=str(e))
        record_failure(project_id, str(e))
        return

    if attachment_path:
        data = download_attachment(attachment_path)
        if data is not None:
            try:
                client.attach_image(alert_id, downscale(data))
            except (SensingCluesError, OSError) as e:
                # The observation is in the group already; a lost photo is
                # not a failed delivery, but it is worth seeing in the logs.
                # OSError is Pillow refusing the bytes.
                logger.warning(
                    "Observation posted but image failed",
                    log_id=log_id,
                    alert_id=alert_id,
                    error=str(e),
                )

    update_notification_status(log_id, 'sent')
    record_success(project_id)
    logger.info(
        "Sensingclues observation sent",
        log_id=log_id,
        project_id=project_id,
        alert_id=alert_id,
    )


def main() -> None:
    logger.info("Starting sensingclues notifications worker")

    queue = RedisQueue(QUEUE_NOTIFICATION_SENSINGCLUES)
    logger.info("Listening for sensingclues observations", queue=QUEUE_NOTIFICATION_SENSINGCLUES)

    try:
        queue.consume_forever(
            process_message, heartbeat_key=HEARTBEAT_KEY_NOTIFICATIONS_SENSINGCLUES
        )
    except KeyboardInterrupt:
        logger.info("Shutting down sensingclues notifications worker")


if __name__ == "__main__":
    main()
