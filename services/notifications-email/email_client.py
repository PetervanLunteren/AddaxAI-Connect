"""
Email client for sending SMTP emails.

Supports both HTML and plain text emails with auto-detection of TLS mode.
"""
import asyncio
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

from shared.config import get_settings
from shared.logger import get_logger

logger = get_logger("notifications-email.client")
settings = get_settings()


class EmailClient:
    """SMTP email client for notification delivery"""

    def __init__(self):
        """Initialize email client with SMTP configuration."""
        self._validated = False

    def _validate_config(self):
        """
        Validate email configuration.

        Raises:
            ValueError: If required settings are missing
        """
        if self._validated:
            return

        if not all([
            settings.mail_server,
            settings.mail_port,
            settings.mail_username,
            settings.mail_password,
            settings.mail_from,
        ]):
            raise ValueError(
                "Email configuration incomplete. Required: "
                "MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM"
            )

        self._validated = True

    async def send_email(
        self,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: Optional[str] = None
    ) -> None:
        """
        Send email via SMTP.

        Args:
            to_email: Recipient email address
            subject: Email subject line
            body_text: Plain text body
            body_html: HTML body (optional)

        Raises:
            aiosmtplib.SMTPException: If email sending fails
            ValueError: If configuration is incomplete
        """
        self._validate_config()

        logger.info(
            "Sending email",
            to_email=to_email,
            subject=subject[:50],
            has_html=body_html is not None
        )

        try:
            # Create message
            if body_html:
                # Multipart message with HTML and plain text
                message = MIMEMultipart('alternative')
                message['Subject'] = subject
                message['From'] = settings.mail_from
                message['To'] = to_email

                # Attach plain text first (fallback)
                text_part = MIMEText(body_text, 'plain', 'utf-8')
                message.attach(text_part)

                # Attach HTML second (preferred)
                html_part = MIMEText(body_html, 'html', 'utf-8')
                message.attach(html_part)
            else:
                # Plain text only
                message = MIMEText(body_text, 'plain', 'utf-8')
                message['Subject'] = subject
                message['From'] = settings.mail_from
                message['To'] = to_email

            # Auto-detect TLS mode based on port
            port = settings.mail_port

            if port == 465:
                # Implicit TLS (SMTPS)
                await aiosmtplib.send(
                    message,
                    hostname=settings.mail_server,
                    port=port,
                    username=settings.mail_username,
                    password=settings.mail_password,
                    use_tls=True,
                )
            else:
                # STARTTLS for port 587 or other ports
                await aiosmtplib.send(
                    message,
                    hostname=settings.mail_server,
                    port=port,
                    username=settings.mail_username,
                    password=settings.mail_password,
                    start_tls=True,
                )

            logger.info(
                "Email sent successfully",
                to_email=to_email,
                subject=subject[:50]
            )

        except Exception as e:
            logger.error(
                "Failed to send email",
                to_email=to_email,
                subject=subject[:50],
                error=str(e),
                error_type=type(e).__name__
            )
            raise

    def send_email_sync(
        self,
        to_email: str,
        subject: str,
        body_text: str,
        body_html: Optional[str] = None
    ) -> None:
        """
        Synchronous wrapper for send_email.

        Args:
            to_email: Recipient email address
            subject: Email subject line
            body_text: Plain text body
            body_html: HTML body (optional)
        """
        asyncio.run(self.send_email(to_email, subject, body_text, body_html))


# Singleton instance
_email_client: Optional[EmailClient] = None


def get_email_client() -> EmailClient:
    """Get email client singleton instance."""
    global _email_client
    if _email_client is None:
        _email_client = EmailClient()
    return _email_client
