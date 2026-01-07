"""
Signal client wrapper for signal-cli-rest-api

API documentation: https://bbernhard.github.io/signal-cli-rest-api/
"""
import base64
from typing import Optional
import requests

from shared.logger import get_logger
from shared.database import get_sync_session
from shared.models import SignalConfig

logger = get_logger("notifications-signal.client")


class SignalNotConfiguredError(Exception):
    """Raised when Signal is not configured (no registered phone number)"""
    pass


class SignalClient:
    """
    Wrapper for signal-cli-rest-api.

    Handles sending Signal messages with optional image attachments.
    """

    def __init__(self, api_url: str = "http://signal-api:8080"):
        """
        Initialize Signal client.

        Args:
            api_url: URL of signal-cli-rest-api service
        """
        self.api_url = api_url.rstrip('/')
        self.phone_number = self._get_registered_number()

        if not self.phone_number:
            raise SignalNotConfiguredError(
                "Signal phone number not configured. Configure in admin settings."
            )

    def _get_registered_number(self) -> Optional[str]:
        """
        Get registered Signal phone number from database.

        Returns:
            Phone number in E.164 format or None if not configured
        """
        with get_sync_session() as session:
            config = session.query(SignalConfig).first()

            if not config:
                logger.error("SignalConfig not found in database")
                return None

            if not config.is_registered or not config.phone_number:
                logger.error("Signal not registered", is_registered=config.is_registered)
                return None

            return config.phone_number

    def send_message(
        self,
        recipient: str,
        message: str,
        attachment_bytes: Optional[bytes] = None
    ) -> None:
        """
        Send Signal message with optional image attachment.

        Args:
            recipient: Recipient phone number in E.164 format (e.g., +1234567890)
            message: Message text
            attachment_bytes: Optional image bytes to attach

        Raises:
            requests.HTTPError: If API call fails
            SignalNotConfiguredError: If Signal not configured
        """
        # Prepare payload
        payload = {
            "message": message,
            "number": self.phone_number,
            "recipients": [recipient],
        }

        # Add attachment if present
        if attachment_bytes:
            # Encode image as base64
            base64_image = base64.b64encode(attachment_bytes).decode('utf-8')
            payload["base64_attachments"] = [base64_image]

        # Send request
        url = f"{self.api_url}/v2/send"

        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()

            logger.info(
                "Signal message sent successfully",
                recipient=recipient[:5] + "***",
                has_attachment=attachment_bytes is not None
            )

        except requests.exceptions.RequestException as e:
            logger.error(
                "Failed to send Signal message",
                error=str(e),
                status_code=getattr(e.response, 'status_code', None),
                response_text=getattr(e.response, 'text', None)
            )
            raise

    def check_health(self) -> bool:
        """
        Check if Signal API is healthy and number is registered.

        Returns:
            True if healthy, False otherwise
        """
        try:
            url = f"{self.api_url}/v1/health"
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            return True
        except Exception as e:
            logger.error("Signal API health check failed", error=str(e))
            return False
