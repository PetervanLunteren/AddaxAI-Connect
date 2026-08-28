"""
EarthRanger notifications worker

Consumes QUEUE_NOTIFICATION_EARTHRANGER and posts each event to the Gundi
sensors API with the project's own API key, then attaches the annotated
image. Gundi forwards both to the EarthRanger site the project's Gundi
connection points at.

One message is one event. The coordinator already decided that the rule
matched and wrote the notification log row; this worker only delivers and
records the outcome, on the log row and on the project's integration row
(last_sent_at, events_sent, last_error, health_status) so the integration
page can show whether the connection works.

Like the email and Telegram workers there is no retry: a failed send is
logged as failed with the reason and the message is dropped. Gundi itself
retries delivery to EarthRanger for a day once it has accepted the event.

A development server needs no guard here: scripts/restore.sh deletes the
restored project_integrations rows on a dev box, so dev only holds keys
someone pasted there on purpose.
"""
from typing import Any, Dict, Optional

from shared.earthranger import GundiClient, GundiError
from shared.logger import get_logger
from shared.queue import (
    RedisQueue,
    QUEUE_NOTIFICATION_EARTHRANGER,
    HEARTBEAT_KEY_NOTIFICATIONS_EARTHRANGER,
)
from shared.storage import StorageClient, BUCKET_THUMBNAILS

from db_operations import (
    load_api_key,
    record_failure,
    record_success,
    update_notification_status,
)

logger = get_logger("notifications-earthranger")


def download_attachment(minio_path: str) -> Optional[bytes]:
    """The annotated image from the thumbnails bucket, or None when it is
    gone (they expire after a day) or storage is unreachable. The event
    still goes out; an alert without a photo beats no alert."""
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
        'event': dict,                          # Gundi event payload
        'attachment_minio_path': str | None,    # key in the thumbnails bucket
    }
    """
    log_id = message.get('notification_log_id')
    project_id = message.get('project_id')
    event = message.get('event')
    attachment_path = message.get('attachment_minio_path')

    if not log_id or not project_id or not isinstance(event, dict):
        logger.error(
            "Invalid message format",
            has_log_id=log_id is not None,
            has_project_id=project_id is not None,
            has_event=isinstance(event, dict),
        )
        return

    logger.info(
        "Processing earthranger event",
        log_id=log_id,
        project_id=project_id,
        event_type=event.get('event_type'),
        has_attachment=attachment_path is not None,
    )

    api_key = load_api_key(project_id)
    if not api_key:
        reason = "EarthRanger integration is not enabled for this project"
        logger.warning(reason, log_id=log_id, project_id=project_id)
        update_notification_status(log_id, 'failed', error_message=reason)
        return

    client = GundiClient(api_key)
    try:
        object_id = client.create_event(event)
    except GundiError as e:
        logger.error(
            "Failed to post earthranger event",
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
                client.attach_file(object_id, attachment_path.rsplit('/', 1)[-1], data)
            except GundiError as e:
                # The event is on the map already; a lost photo is not a
                # failed delivery, but it is worth seeing in the logs
                logger.warning(
                    "Event posted but attachment failed",
                    log_id=log_id,
                    object_id=object_id,
                    error=str(e),
                )

    update_notification_status(log_id, 'sent')
    record_success(project_id)
    logger.info(
        "Earthranger event sent",
        log_id=log_id,
        project_id=project_id,
        object_id=object_id,
    )


def main() -> None:
    logger.info("Starting earthranger notifications worker")

    queue = RedisQueue(QUEUE_NOTIFICATION_EARTHRANGER)
    logger.info("Listening for earthranger events", queue=QUEUE_NOTIFICATION_EARTHRANGER)

    try:
        queue.consume_forever(
            process_message, heartbeat_key=HEARTBEAT_KEY_NOTIFICATIONS_EARTHRANGER
        )
    except KeyboardInterrupt:
        logger.info("Shutting down earthranger notifications worker")


if __name__ == "__main__":
    main()
