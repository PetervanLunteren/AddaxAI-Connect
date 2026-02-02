"""
Email Notifications Worker

Consumes messages from QUEUE_NOTIFICATION_EMAIL and sends via SMTP.
Supports both HTML and plain text emails for reports and notifications.
"""
from typing import Dict, Any

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_EMAIL
from shared.config import get_settings

from email_client import get_email_client
from db_operations import update_notification_status

logger = get_logger("notifications-email")
settings = get_settings()


def process_email_message(message: Dict[str, Any]) -> None:
    """
    Process email notification message.

    Expected message structure:
    {
        'notification_log_id': int,
        'to_email': str,
        'subject': str,
        'body_text': str,
        'body_html': str | None
    }

    Args:
        message: Queue message with email details
    """
    log_id = message.get('notification_log_id')
    to_email = message.get('to_email')
    subject = message.get('subject')
    body_text = message.get('body_text')
    body_html = message.get('body_html')

    # Validate required fields (log_id is optional for test messages)
    if not all([to_email, subject, body_text]):
        logger.error(
            "Invalid message format",
            has_log_id=log_id is not None,
            has_to_email=bool(to_email),
            has_subject=bool(subject),
            has_body_text=bool(body_text)
        )
        return

    logger.info(
        "Processing email message",
        log_id=log_id,
        to_email=to_email,
        subject=subject[:50] if subject else None
    )

    try:
        # Send email
        email_client = get_email_client()
        email_client.send_email_sync(
            to_email=to_email,
            subject=subject,
            body_text=body_text,
            body_html=body_html
        )

        # Update notification log status (if log_id provided)
        if log_id:
            update_notification_status(log_id, 'sent')

        logger.info(
            "Email sent successfully",
            log_id=log_id,
            to_email=to_email
        )

    except Exception as e:
        error_msg = str(e)
        logger.error(
            "Failed to send email",
            log_id=log_id,
            to_email=to_email,
            error=error_msg,
            exc_info=True
        )

        # Update notification log with error (if log_id provided)
        if log_id:
            update_notification_status(log_id, 'failed', error_message=error_msg)

        # Re-raise to potentially trigger retry logic in the future
        raise


def main() -> None:
    """Main entry point for email notifications worker."""
    logger.info(
        "Starting email notifications worker",
        mail_server=settings.mail_server,
        mail_port=settings.mail_port
    )

    # Validate email configuration on startup
    try:
        email_client = get_email_client()
        email_client._validate_config()
        logger.info("Email configuration validated")
    except ValueError as e:
        logger.error("Email configuration invalid", error=str(e))
        raise

    # Listen to email queue
    queue = RedisQueue(QUEUE_NOTIFICATION_EMAIL)

    logger.info("Listening for email messages", queue=QUEUE_NOTIFICATION_EMAIL)

    try:
        queue.consume_forever(process_email_message)
    except KeyboardInterrupt:
        logger.info("Shutting down email notifications worker")


if __name__ == "__main__":
    main()
