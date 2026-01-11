"""
Telegram Bot API client

API documentation: https://core.telegram.org/bots/api
"""
import requests
from typing import Optional
from io import BytesIO

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import TelegramConfig

logger = get_logger("notifications-telegram.client")


class TelegramNotConfiguredError(Exception):
    """Raised when Telegram bot is not configured"""
    pass


class TelegramClient:
    """
    Wrapper for Telegram Bot API

    Handles sending messages and polling for updates (for /start command).
    """

    def __init__(self):
        """Initialize Telegram client"""
        bot_token, bot_username, is_configured = self._get_config()
        if not is_configured:
            raise TelegramNotConfiguredError(
                "Telegram bot not configured. Configure in admin settings."
            )

        self.bot_token = bot_token
        self.bot_username = bot_username
        self.base_url = f"https://api.telegram.org/bot{self.bot_token}"

    def _get_config(self) -> tuple[Optional[str], Optional[str], bool]:
        """Get bot configuration from database"""
        with get_sync_session() as session:
            config = session.query(TelegramConfig).first()
            if not config:
                return None, None, False
            # Eagerly access attributes while in session
            return config.bot_token, config.bot_username, config.is_configured

    def send_message(
        self,
        chat_id: str,
        text: str,
        photo_bytes: Optional[bytes] = None
    ) -> None:
        """
        Send message with optional photo attachment

        Args:
            chat_id: Telegram chat ID (numeric string)
            text: Message text (supports Markdown)
            photo_bytes: Optional image bytes

        Raises:
            requests.HTTPError: If API call fails
        """
        if photo_bytes:
            # Send photo with caption
            url = f"{self.base_url}/sendPhoto"
            files = {'photo': BytesIO(photo_bytes)}
            data = {
                'chat_id': chat_id,
                'caption': text,
                'parse_mode': 'Markdown'
            }
            response = requests.post(url, data=data, files=files, timeout=30)
        else:
            # Send text only
            url = f"{self.base_url}/sendMessage"
            data = {
                'chat_id': chat_id,
                'text': text,
                'parse_mode': 'Markdown'
            }
            response = requests.post(url, json=data, timeout=30)

        response.raise_for_status()

        logger.info(
            "Telegram message sent",
            chat_id=chat_id[:5] + "***" if len(chat_id) > 5 else chat_id,
            has_photo=photo_bytes is not None
        )

    def check_health(self) -> bool:
        """
        Check if bot token is valid

        Returns:
            True if bot is accessible, False otherwise
        """
        try:
            url = f"{self.base_url}/getMe"
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            return True
        except Exception as e:
            logger.error("Telegram health check failed", error=str(e))
            return False

    def get_updates(self, offset: Optional[int] = None, timeout: int = 30) -> list:
        """
        Get updates from Telegram (long polling)

        Args:
            offset: Offset for getting new updates
            timeout: Long polling timeout in seconds

        Returns:
            List of update objects
        """
        url = f"{self.base_url}/getUpdates"
        params = {
            'timeout': timeout,
            'allowed_updates': ['message']
        }

        if offset is not None:
            params['offset'] = offset

        try:
            response = requests.get(url, params=params, timeout=timeout + 5)
            response.raise_for_status()
            data = response.json()

            if data.get('ok'):
                return data.get('result', [])
            else:
                logger.error("getUpdates failed", error=data.get('description'))
                return []

        except Exception as e:
            logger.error("Failed to get updates", error=str(e))
            return []

    def send_reply(self, chat_id: str, text: str) -> None:
        """
        Send a simple text reply (used for bot commands)

        Args:
            chat_id: Chat ID to reply to
            text: Reply text
        """
        url = f"{self.base_url}/sendMessage"
        data = {
            'chat_id': chat_id,
            'text': text
        }

        try:
            response = requests.post(url, json=data, timeout=10)
            response.raise_for_status()
            logger.info("Bot reply sent", chat_id=chat_id[:5] + "***")
        except Exception as e:
            logger.error("Failed to send reply", error=str(e))
