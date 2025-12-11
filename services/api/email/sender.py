"""
Email sender using SMTP via aiosmtplib.

Sends verification and password reset emails.
Crashes loudly if email configuration is missing.
"""
import aiosmtplib
from email.message import EmailMessage
from typing import Optional

from shared.config import get_settings


class EmailSender:
    """SMTP email sender for authentication flows"""

    def __init__(self):
        """
        Initialize email sender with SMTP configuration.

        Crashes if required email settings are not configured.
        """
        self.settings = get_settings()

        # Explicit configuration - crash if not set
        if not all([
            self.settings.mail_server,
            self.settings.mail_port,
            self.settings.mail_username,
            self.settings.mail_password,
            self.settings.mail_from,
            self.settings.domain_name,
        ]):
            raise ValueError(
                "Email configuration incomplete. Required: "
                "MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM, DOMAIN_NAME"
            )

    async def send_email(
        self,
        to_email: str,
        subject: str,
        body: str,
    ) -> None:
        """
        Send email via SMTP.

        Args:
            to_email: Recipient email address
            subject: Email subject line
            body: Email body (plain text)

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        message = EmailMessage()
        message["From"] = self.settings.mail_from
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(body)

        await aiosmtplib.send(
            message,
            hostname=self.settings.mail_server,
            port=self.settings.mail_port,
            username=self.settings.mail_username,
            password=self.settings.mail_password,
            start_tls=True,
        )

    async def send_verification_email(
        self,
        email: str,
        token: str,
    ) -> None:
        """
        Send email verification link.

        Args:
            email: User's email address
            token: Verification token

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        verification_url = f"https://{self.settings.domain_name}/verify-email?token={token}"

        subject = "AddaxAI Connect - Verify Your Email"
        body = f"""
Welcome to AddaxAI Connect!

Please verify your email address by clicking the link below:

{verification_url}

This link will expire in 24 hours.

If you did not create an account, please ignore this email.

---
AddaxAI Connect
Camera Trap Image Processing Platform
"""

        await self.send_email(email, subject, body)

    async def send_password_reset_email(
        self,
        email: str,
        token: str,
    ) -> None:
        """
        Send password reset link.

        Args:
            email: User's email address
            token: Password reset token

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        reset_url = f"https://{self.settings.domain_name}/reset-password?token={token}"

        subject = "AddaxAI Connect - Password Reset"
        body = f"""
You requested a password reset for your AddaxAI Connect account.

Click the link below to reset your password:

{reset_url}

This link will expire in 1 hour.

If you did not request a password reset, please ignore this email.
Your password will not be changed.

---
AddaxAI Connect
Camera Trap Image Processing Platform
"""

        await self.send_email(email, subject, body)


# Singleton instance
_email_sender: Optional[EmailSender] = None


def get_email_sender() -> EmailSender:
    """
    Get email sender singleton instance.

    Returns:
        EmailSender instance

    Raises:
        ValueError: If email configuration is incomplete
    """
    global _email_sender
    if _email_sender is None:
        _email_sender = EmailSender()
    return _email_sender
