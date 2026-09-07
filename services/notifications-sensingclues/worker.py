"""
Sensing Clues notifications worker

Consumes QUEUE_NOTIFICATION_SENSINGCLUES and posts each observation into
the project's Cluey group with the server's service account, then
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

The worker runs on every server, also one without a service account. It
then idles and heartbeats, which is the truthful health row; a message
that reaches it anyway (queued before the account was removed) is marked
failed with the reason.

A development server needs no guard here: its own environment points at
the Sensing Clues test host, and scripts/restore.sh deletes the restored
project_integrations rows on a dev box, so dev only holds group ids
someone saved there on purpose.
"""
from io import BytesIO
from typing import Any, Dict, Optional

from PIL import Image

from shared.config import get_settings
from shared.logger import get_logger
from shared.queue import (
    RedisQueue,
    QUEUE_NOTIFICATION_SENSINGCLUES,
    HEARTBEAT_KEY_NOTIFICATIONS_SENSINGCLUES,
)
from shared.sensingclues import (
    SensingCluesClient,
    SensingCluesError,
    client_from_settings,
    is_available,
)
from shared.storage import StorageClient, BUCKET_THUMBNAILS

from db_operations import (
    load_group_id,
    record_failure,
    record_success,
    update_notification_status,
)

logger = get_logger("notifications-sensingclues")
settings = get_settings()

# Cluey wants a thumbnail of about 100 KB, not the 1280 px annotated image.
# Longest side 800 px at quality 80 lands there for a camera trap photo.
MAX_SIDE_PX = 800
JPEG_QUALITY = 80

NOT_ON_SERVER = "Sensing Clues is not enabled on this server"

_client: Optional[SensingCluesClient] = None


def get_client() -> SensingCluesClient:
    """One client per process, so the token from the first login serves
    every message after it. Changing the credentials needs a restart."""
    global _client
    if _client is None:
        _client = client_from_settings(settings)
    return _client


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

    if not is_available(settings):
        logger.warning(NOT_ON_SERVER, log_id=log_id, project_id=project_id)
        update_notification_status(log_id, 'failed', error_message=NOT_ON_SERVER)
        return

    group_id = load_group_id(project_id)
    if not group_id:
        reason = "Sensing Clues integration is not enabled for this project"
        logger.warning(reason, log_id=log_id, project_id=project_id)
        update_notification_status(log_id, 'failed', error_message=reason)
        return

    try:
        alert_id = get_client().create_observation(group_id, observation)
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
                filename = attachment_path.rsplit('/', 1)[-1]
                get_client().attach_image(alert_id, filename, downscale(data))
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
    logger.info("Starting sensingclues notifications worker", available=is_available(settings))

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
