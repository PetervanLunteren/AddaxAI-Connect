"""
Signal Notifications Worker

Consumes messages from QUEUE_NOTIFICATION_SIGNAL and sends via Signal.
"""
from typing import Dict, Any, Optional

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_SIGNAL
from shared.config import get_settings

from signal_client import SignalClient, SignalNotConfiguredError
from image_handler import download_image_from_minio
from db_operations import update_notification_status

logger = get_logger("notifications-signal")
settings = get_settings()


def process_signal_message(message: Dict[str, Any]) -> None:
    """
    Process Signal notification message.

    Args:
        message: Message from Signal queue

    Expected structure:
    {
        'notification_log_id': int,
        'recipient_phone': str,  # E.164 format
        'message_text': str,
        'attachment_path': str or None  # MinIO path
    }
    """
    log_id = message.get('notification_log_id')
    recipient_phone = message.get('recipient_phone')
    message_text = message.get('message_text')
    attachment_path = message.get('attachment_path')

    # Validate required fields
    if not all([log_id, recipient_phone, message_text]):
        logger.error("Missing required fields in Signal message", message=message)
        return

    logger.info(
        "Processing Signal notification",
        log_id=log_id,
        recipient_phone=recipient_phone[:5] + "***",  # Partial mask for privacy
        has_attachment=attachment_path is not None
    )

    try:
        # Initialize Signal client
        signal_client = SignalClient()

        # Download image attachment if present
        attachment_bytes: Optional[bytes] = None
        if attachment_path:
            try:
                attachment_bytes = download_image_from_minio(attachment_path)
                logger.debug("Downloaded attachment", path=attachment_path)
            except Exception as e:
                logger.warning(
                    "Failed to download attachment, sending without image",
                    path=attachment_path,
                    error=str(e)
                )
                # Continue without attachment

        # Send Signal message
        signal_client.send_message(
            recipient=recipient_phone,
            message=message_text,
            attachment_bytes=attachment_bytes
        )

        # Update notification log status to 'sent'
        update_notification_status(log_id, status='sent')

        logger.info("Signal notification sent", log_id=log_id)

    except SignalNotConfiguredError as e:
        # Signal not configured - mark as failed
        error_msg = "Signal not configured. Please configure Signal in admin settings."
        logger.error("Signal not configured", log_id=log_id)
        update_notification_status(log_id, status='failed', error_message=error_msg)

    except Exception as e:
        # Other errors - mark as failed
        error_msg = f"Failed to send Signal message: {str(e)}"
        logger.error(
            "Failed to send Signal notification",
            log_id=log_id,
            error=str(e),
            exc_info=True
        )
        update_notification_status(log_id, status='failed', error_message=error_msg)
        raise


def main() -> None:
    """Main entry point for Signal worker"""
    logger.info("Starting Signal notifications worker")

    # Listen to Signal queue
    queue = RedisQueue(QUEUE_NOTIFICATION_SIGNAL)

    logger.info("Listening for Signal notification messages")

    try:
        queue.consume_forever(process_signal_message)
    except KeyboardInterrupt:
        logger.info("Shutting down Signal notifications worker")


if __name__ == "__main__":
    main()
