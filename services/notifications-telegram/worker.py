"""
Telegram Notifications Worker

Handles two tasks:
1. Consumes messages from QUEUE_NOTIFICATION_TELEGRAM and sends via Telegram Bot API
2. Polls for /start commands from users, links the chat to a project, and replies

The worker runs two threads:
- Main thread: processes notification messages from queue
- Background thread: polls Telegram API for /start commands
"""
from typing import Dict, Any, Optional
import threading
import time

from shared.logger import get_logger
from shared.queue import RedisQueue, QUEUE_NOTIFICATION_TELEGRAM, HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM
from shared.config import get_settings
from shared.notify_guard import chat_id_allowed, is_development
from shared.database import get_sync_session
from shared.models import TelegramLinkingToken, ProjectNotificationPreference, Project
from datetime import datetime, timezone

from telegram_client import TelegramClient, TelegramNotConfiguredError
from db_operations import update_notification_status
from shared.storage import StorageClient
import requests

logger = get_logger("notifications-telegram")
settings = get_settings()

# Global variable to track last update ID for polling
last_update_id = None


def handle_link_token(token: str, chat_id: str) -> Optional[str]:
    """
    Process a linking token from /start command

    Args:
        token: The token from /start <token>
        chat_id: The Telegram chat ID

    Returns:
        The name of the project the chat is now linked to, or None if the
        token is invalid, used or expired
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
                return None

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

            project_name = session.get(Project, link_record.project_id).name

            session.commit()

            logger.info(
                "Successfully linked Telegram account",
                user_id=link_record.user_id,
                project_id=link_record.project_id,
                chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id
            )

            return project_name

    except Exception as e:
        logger.error(
            "Failed to process linking token",
            error=str(e),
            exc_info=True
        )
        return None


def start_reply(text: str, chat_id: str) -> str:
    """
    Handle a /start message and return the bot's reply.

    The link is per project, and one chat may hold the links of several
    projects, so the reply names the project. Otherwise three links in one
    chat read as three replacements. Plain text, because send_reply sets no
    parse_mode.
    """
    parts = text.split()
    token = parts[1] if len(parts) > 1 else None

    if not token:
        domain = settings.domain_name or "your-domain.com"
        return (
            "👋 Welcome to AddaxAI Connect!\n\n"
            f"Your chat ID is {chat_id}\n\n"
            "To link this chat, use the link on the Notifications page of "
            f"your project at https://{domain}"
        )

    project_name = handle_link_token(token, chat_id)
    if project_name is None:
        return (
            "❌ This link is invalid, expired or already used.\n\n"
            "Open the Notifications page of your project in AddaxAI Connect "
            "and link again."
        )
    return (
        f"✅ Linked to project {project_name}.\n\n"
        "Alerts from this project now come to this chat. To get alerts from "
        "another project here too, link it from that project's "
        "Notifications page."
    )


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
        logger.error("Missing required fields in Telegram message", payload=message)
        return

    logger.info(
        "Processing Telegram notification",
        log_id=log_id,
        chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id,
        has_attachment=annotated_minio_path is not None,
        has_buttons=reply_markup is not None
    )

    # A restored production database carries every real chat id, so a dev bot
    # would message actual users. restore.sh clears the bot token on a dev box,
    # which covers the usual case but not one configured for a fire drill.
    allowed, reason = chat_id_allowed(chat_id)
    if not allowed:
        logger.warning(
            "Blocked Telegram message on a development server",
            log_id=log_id,
            chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id,
            reason=reason,
        )
        update_notification_status(log_id, status='blocked', error_message=reason)
        return

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

        # Do NOT delete the attachment here. One source photo produces one
        # annotated image, but the coordinator fans a detection out to one
        # message per species and per subscribed user, and every one of them
        # carries this same path. Deleting after the first send left every
        # later recipient with a text-only message. MinIO expires the
        # annotated/ prefix on a lifecycle rule instead (minio-init).
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
                    client.send_reply(chat_id, start_reply(text, chat_id))

                    logger.info(
                        "Replied to /start command",
                        chat_id=chat_id[:5] + "***",
                        username=message.get('from', {}).get('username'),
                        has_token=len(text.split()) > 1
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

    # Say it out loud at boot, so a silent dev box is never a mystery.
    if is_development():
        logger.warning(
            "Development server: Telegram is restricted to the allow-list",
            allow_list=get_settings().dev_notify_chat_ids or "(empty, everything is blocked)",
        )

    # Start background thread for bot command polling.
    #
    # Not on a dev server with an empty allow-list. Telegram lets exactly one
    # client hold getUpdates for a token, so a dev box restored from a
    # production backup carries the production bot token and steals /start
    # messages from the real server, which answers 409 Conflict to whichever
    # poller loses the race. That is the 12 Aug 2026 incident, and blocking
    # outbound messages alone does not prevent it because polling is a read.
    # An allow-list with entries means Telegram on dev was set up deliberately,
    # so polling is wanted there.
    if is_development() and not get_settings().dev_notify_chat_ids.strip():
        logger.warning(
            "Development server with no Telegram allow-list: not polling for "
            "/start commands, so this server cannot steal them from production"
        )
    else:
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
        queue.consume_forever(
            process_telegram_message, heartbeat_key=HEARTBEAT_KEY_NOTIFICATIONS_TELEGRAM
        )
    except KeyboardInterrupt:
        logger.info("Shutting down Telegram notifications worker")


if __name__ == "__main__":
    main()
