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

from telegram_client import TelegramClient, TelegramNotConfiguredError
from db_operations import update_notification_status
import requests

logger = get_logger("notifications-telegram")
settings = get_settings()

# Global variable to track last update ID for polling
last_update_id = None


def download_image_from_api(api_url: str) -> bytes:
    """
    Download annotated image from API endpoint.

    Args:
        api_url: API endpoint URL (e.g., "/api/images/{uuid}/annotated")

    Returns:
        Image bytes

    Raises:
        Exception: If download fails
    """
    # Get API base URL from settings
    api_host = settings.api_host or "api:8000"
    if not api_url.startswith('http'):
        # Relative URL - construct full URL
        full_url = f"http://{api_host}{api_url}"
    else:
        full_url = api_url

    logger.debug("Fetching image from API", url=full_url)

    try:
        # Make internal API request (no auth needed for internal calls)
        response = requests.get(full_url, timeout=30)
        response.raise_for_status()

        logger.debug(
            "Downloaded image from API",
            url=api_url,
            size_bytes=len(response.content)
        )

        return response.content

    except Exception as e:
        logger.error(
            "Failed to download image from API",
            url=api_url,
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
        'attachment_url': str or None,  # API URL to annotated image
        'reply_markup': dict or None  # Optional inline keyboard
    }
    """
    log_id = message.get('notification_log_id')
    chat_id = message.get('chat_id')
    message_text = message.get('message_text')
    attachment_url = message.get('attachment_url')
    reply_markup = message.get('reply_markup')

    # Validate required fields
    if not all([log_id, chat_id, message_text]):
        logger.error("Missing required fields in Telegram message", message=message)
        return

    logger.info(
        "Processing Telegram notification",
        log_id=log_id,
        chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id,
        has_attachment=attachment_url is not None,
        has_buttons=reply_markup is not None
    )

    try:
        # Initialize Telegram client
        client = TelegramClient()

        # Download image attachment if present
        photo_bytes: Optional[bytes] = None
        if attachment_url:
            try:
                photo_bytes = download_image_from_api(attachment_url)
                logger.debug("Downloaded attachment from API", url=attachment_url)
            except Exception as e:
                logger.warning(
                    "Failed to download attachment, sending without image",
                    url=attachment_url,
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
                if text.strip().lower() == '/start':
                    domain = settings.domain_name or "your-domain.com"

                    reply_text = (
                        f"🤖 *Welcome to AddaxAI Connect!*\n\n"
                        f"Your chat ID is: `{chat_id}`\n\n"
                        f"*How to enable notifications:*\n"
                        f"1. Copy your chat ID above\n"
                        f"2. Visit https://{domain}\n"
                        f"3. Go to Project Settings → Notifications\n"
                        f"4. Paste your chat ID in the Telegram field\n"
                        f"5. Select notification types and save\n\n"
                        f"You'll receive alerts about species detections, "
                        f"camera battery status, and system health!"
                    )

                    client.send_reply(chat_id, reply_text)

                    logger.info(
                        "Replied to /start command",
                        chat_id=chat_id[:5] + "***",
                        username=message.get('from', {}).get('username')
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
