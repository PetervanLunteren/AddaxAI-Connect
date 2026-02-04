"""
Telegram Notifications Worker

Handles two tasks:
1. Consumes messages from QUEUE_NOTIFICATION_TELEGRAM and sends via Telegram Bot API
2. Polls for /start commands from users and replies with their chat ID

The worker runs two threads:
- Main thread: processes notification messages from queue
- Background thread: polls Telegram API for /start commands
"""
from typing import Dict, Any, Optional
import threading
import time

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_TELEGRAM
from shared.config import get_settings
from shared.database import get_sync_session
from shared.models import TelegramLinkingToken, ProjectNotificationPreference
from datetime import datetime, timezone

from telegram_client import TelegramClient, TelegramNotConfiguredError
from db_operations import update_notification_status
from shared.storage import StorageClient
import requests

logger = get_logger("notifications-telegram")
settings = get_settings()

# Global variable to track last update ID for polling
last_update_id = None


def handle_link_token(token: str, chat_id: str) -> bool:
    """
    Process a linking token from /start command

    Args:
        token: The token from /start <token>
        chat_id: The Telegram chat ID

    Returns:
        True if linking was successful, False otherwise
    """
    try:
        with get_sync_session() as session:
            # Look up token in database
            link_record = session.query(TelegramLinkingToken).filter(
                TelegramLinkingToken.token == token,
                TelegramLinkingToken.used == False,
                TelegramLinkingToken.expires_at > datetime.now(timezone.utc)
            ).first()

            if not link_record:
                logger.warning(
                    "Invalid or expired linking token",
                    token_prefix=token[:8] + "***" if len(token) > 8 else token
                )
                return False

            # Get or create notification preferences
            prefs = session.query(ProjectNotificationPreference).filter(
                ProjectNotificationPreference.user_id == link_record.user_id,
                ProjectNotificationPreference.project_id == link_record.project_id
            ).first()

            if not prefs:
                # Create new preferences with telegram_chat_id
                prefs = ProjectNotificationPreference(
                    user_id=link_record.user_id,
                    project_id=link_record.project_id,
                    telegram_chat_id=str(chat_id),
                    enabled=False  # User needs to enable explicitly
                )
                session.add(prefs)
            else:
                # Update existing preferences
                prefs.telegram_chat_id = str(chat_id)

            # Mark token as used
            link_record.used = True

            session.commit()

            logger.info(
                "Successfully linked Telegram account",
                user_id=link_record.user_id,
                project_id=link_record.project_id,
                chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id
            )

            return True

    except Exception as e:
        logger.error(
            "Failed to process linking token",
            error=str(e),
            exc_info=True
        )
        return False


def download_image_from_minio(minio_path: str) -> bytes:
    """
    Download annotated image from MinIO storage.

    Args:
        minio_path: Path in MinIO (e.g., "annotated/{uuid}.jpg")

    Returns:
        Image bytes

    Raises:
        Exception: If download fails
    """
    logger.debug("Fetching image from MinIO", path=minio_path)

    try:
        storage = StorageClient()
        image_bytes = storage.download_fileobj(bucket='thumbnails', object_name=minio_path)

        logger.debug(
            "Downloaded image from MinIO",
            path=minio_path,
            size_bytes=len(image_bytes)
        )

        return image_bytes

    except Exception as e:
        logger.error(
            "Failed to download image from MinIO",
            path=minio_path,
            error=str(e)
        )
        raise


def delete_image_from_minio(minio_path: str) -> None:
    """
    Delete annotated image from MinIO after sending notification.

    This ensures images are only temporarily accessible, improving security.

    Args:
        minio_path: Path in MinIO (e.g., "annotated/{uuid}.jpg")
    """
    try:
        storage = StorageClient()
        storage.delete_object(bucket='thumbnails', object_name=minio_path)
        logger.debug("Deleted annotated image from MinIO", path=minio_path)
    except Exception as e:
        # Log but don't fail - image delivery was successful
        logger.warning(
            "Failed to delete annotated image from MinIO",
            path=minio_path,
            error=str(e)
        )


def process_telegram_message(message: Dict[str, Any]) -> None:
    """
    Process Telegram notification message

    Args:
        message: Message from Telegram queue

    Expected structure:
    {
        'notification_log_id': int,
        'chat_id': str,  # Telegram chat ID
        'message_text': str,
        'annotated_minio_path': str or None,  # MinIO path to annotated image
        'reply_markup': dict or None  # Optional inline keyboard
    }
    """
    log_id = message.get('notification_log_id')
    chat_id = message.get('chat_id')
    message_text = message.get('message_text')
    annotated_minio_path = message.get('annotated_minio_path')
    reply_markup = message.get('reply_markup')

    # Validate required fields
    if not all([log_id, chat_id, message_text]):
        logger.error("Missing required fields in Telegram message", message=message)
        return

    logger.info(
        "Processing Telegram notification",
        log_id=log_id,
        chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id,
        has_attachment=annotated_minio_path is not None,
        has_buttons=reply_markup is not None
    )

    try:
        # Initialize Telegram client
        client = TelegramClient()

        # Download image attachment from MinIO if present
        photo_bytes: Optional[bytes] = None
        if annotated_minio_path:
            try:
                photo_bytes = download_image_from_minio(annotated_minio_path)
                logger.debug("Downloaded attachment from MinIO", path=annotated_minio_path)
            except Exception as e:
                logger.warning(
                    "Failed to download attachment, sending without image",
                    path=annotated_minio_path,
                    error=str(e)
                )
                # Continue without attachment

        # Send Telegram message
        client.send_message(
            chat_id=chat_id,
            text=message_text,
            photo_bytes=photo_bytes,
            reply_markup=reply_markup
        )

        # Update notification log status to 'sent'
        update_notification_status(log_id, status='sent')

        # Delete annotated image from MinIO after successful send (security: no persistent public access)
        if annotated_minio_path:
            delete_image_from_minio(annotated_minio_path)

        logger.info("Telegram notification sent", log_id=log_id)

    except TelegramNotConfiguredError:
        # Telegram not configured - mark as failed
        error_msg = "Telegram bot not configured. Please configure Telegram in admin settings."
        logger.error("Telegram not configured", log_id=log_id)
        update_notification_status(log_id, status='failed', error_message=error_msg)

    except Exception as e:
        # Other errors - mark as failed
        error_msg = f"Failed to send Telegram message: {str(e)}"
        logger.error(
            "Failed to send Telegram notification",
            log_id=log_id,
            error=str(e),
            exc_info=True
        )
        update_notification_status(log_id, status='failed', error_message=error_msg)
        raise


def poll_for_start_commands():
    """
    Background thread that polls Telegram API for /start commands

    When a user sends /start to the bot, reply with their chat ID
    so they can configure notifications.

    Runs in infinite loop with 5-second polling interval.
    """
    global last_update_id

    logger.info("Starting Telegram bot command polling thread")

    while True:
        try:
            # Initialize client (will skip if not configured)
            try:
                client = TelegramClient()
            except TelegramNotConfiguredError:
                logger.debug("Telegram not configured yet, skipping polling")
                time.sleep(30)  # Wait longer if not configured
                continue

            # Get updates from Telegram
            updates = client.get_updates(offset=last_update_id, timeout=5)

            for update in updates:
                # Update offset to acknowledge this update
                update_id = update.get('update_id')
                if update_id:
                    last_update_id = update_id + 1

                # Process message if present
                message = update.get('message', {})
                text = message.get('text', '')
                chat = message.get('chat', {})
                chat_id = str(chat.get('id', ''))

                if not chat_id:
                    continue

                # Handle /start command
                if text.strip().lower().startswith('/start'):
                    # Extract payload from /start <token>
                    parts = text.split()
                    token = parts[1] if len(parts) > 1 else None

                    if token:
                        # Token-based linking flow
                        success = handle_link_token(token, chat_id)

                        if success:
                            reply_text = (
                                "✅ *Successfully linked!*\n\n"
                                "You'll now receive notifications from AddaxAI Connect.\n\n"
                                "Go back to the notification settings page to see your status update."
                            )
                        else:
                            reply_text = (
                                "❌ *Invalid or expired linking token*\n\n"
                                "The link you used is either invalid or has already been used.\n\n"
                                "Please generate a new link from the AddaxAI Connect notification settings."
                            )
                    else:
                        # No token - show welcome message with chat ID
                        domain = settings.domain_name or "your-domain.com"
                        reply_text = (
                            f"👋 *Welcome to AddaxAI Connect!*\n\n"
                            f"Your chat ID is: `{chat_id}`\n\n"
                            f"To link your account, please use the setup link provided "
                            f"in your project's notification settings at https://{domain}"
                        )

                    client.send_reply(chat_id, reply_text)

                    logger.info(
                        "Replied to /start command",
                        chat_id=chat_id[:5] + "***",
                        username=message.get('from', {}).get('username'),
                        has_token=token is not None
                    )

        except Exception as e:
            logger.error(
                "Error in bot command polling thread",
                error=str(e),
                exc_info=True
            )

        # Sleep between polling intervals
        time.sleep(5)


def main() -> None:
    """Main entry point for Telegram worker"""
    logger.info("Starting Telegram notifications worker")

    # Start background thread for bot command polling
    polling_thread = threading.Thread(
        target=poll_for_start_commands,
        daemon=True,
        name="TelegramCommandPoller"
    )
    polling_thread.start()
    logger.info("Started background thread for /start command polling")

    # Listen to Telegram queue (main thread)
    queue = RedisQueue(QUEUE_NOTIFICATION_TELEGRAM)

    logger.info("Listening for Telegram notification messages")

    try:
        queue.consume_forever(process_telegram_message)
    except KeyboardInterrupt:
        logger.info("Shutting down Telegram notifications worker")


if __name__ == "__main__":
    main()
