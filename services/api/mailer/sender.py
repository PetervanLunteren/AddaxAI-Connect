"""
Email sender using SMTP via aiosmtplib.

Sends verification and password reset emails.
Crashes loudly if email configuration is missing.
"""
import aiosmtplib
from email.message import EmailMessage
from typing import Optional

from shared.config import get_settings
from shared.logger import get_logger

logger = get_logger("api.mailer")


class EmailSender:
    """SMTP email sender for authentication flows"""

    def __init__(self):
        """
        Initialize email sender with SMTP configuration.

        Configuration is validated lazily on first use.
        """
        self.settings = get_settings()
        self._validated = False

    def _validate_config(self):
        """
        Validate email configuration.

        Crashes if required email settings are not configured.
        Called on first email send attempt.
        """
        if self._validated:
            return

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

        self._validated = True

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
            ValueError: If email configuration is incomplete
        """
        # Validate configuration on first use
        self._validate_config()

        logger.info(
            "Attempting to send email",
            to_email=to_email,
            subject=subject,
            mail_server=self.settings.mail_server,
            mail_port=self.settings.mail_port,
        )

        try:
            message = EmailMessage()
            message["From"] = self.settings.mail_from
            message["To"] = to_email
            message["Subject"] = subject
            message.set_content(body)

            # Auto-detect TLS mode based on port
            # Port 465: use_tls=True (implicit TLS/SSL from start)
            # Port 587: start_tls=True (STARTTLS upgrade)
            # Port 25: no TLS (not recommended)
            port = self.settings.mail_port
            if port == 465:
                # Implicit TLS for port 465 (SMTPS)
                await aiosmtplib.send(
                    message,
                    hostname=self.settings.mail_server,
                    port=port,
                    username=self.settings.mail_username,
                    password=self.settings.mail_password,
                    use_tls=True,
                )
            else:
                # STARTTLS for port 587 or other ports
                await aiosmtplib.send(
                    message,
                    hostname=self.settings.mail_server,
                    port=port,
                    username=self.settings.mail_username,
                    password=self.settings.mail_password,
                    start_tls=True,
                )

            logger.info(
                "Email sent successfully",
                to_email=to_email,
                subject=subject,
            )

        except Exception as e:
            logger.error(
                "Failed to send email",
                to_email=to_email,
                subject=subject,
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            raise

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
Realtime camera trap image processing platform
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
        logger.info(
            "Preparing password reset email",
            email=email,
            token_length=len(token) if token else 0,
        )

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
Realtime camera trap image processing platform
"""

        await self.send_email(email, subject, body)

        logger.info(
            "Password reset email sent",
            email=email,
        )

    async def send_invitation_email(
        self,
        email: str,
        project_name: str,
        role: str,
        inviter_name: str,
        inviter_email: str,
    ) -> None:
        """
        Send project invitation email.

        Args:
            email: Invited user's email address
            project_name: Name of the project they're invited to
            role: Role they're assigned (e.g., 'project-admin', 'project-viewer')
            inviter_name: Name of the person who sent the invitation
            inviter_email: Email of the person who sent the invitation

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        logger.info(
            "Preparing invitation email",
            email=email,
            project_name=project_name,
            role=role,
        )

        # Format role for display
        role_display = role.replace('-', ' ').title()

        # Registration link with pre-filled email
        registration_url = f"https://{self.settings.domain_name}/register?email={email}"

        subject = f"You've been invited to join {project_name} on AddaxAI Connect"
        body = f"""
Hello!

{inviter_name} ({inviter_email}) has invited you to join the "{project_name}" project on AddaxAI Connect.

Your assigned role: {role_display}

To accept this invitation and get started, please register your account:

{registration_url}

Once registered, you'll have immediate access to the project and can start working with camera trap images.

If you have any questions, feel free to reach out to {inviter_name} at {inviter_email}.

---
AddaxAI Connect
Realtime camera trap image processing platform
"""

        await self.send_email(email, subject, body)

        logger.info(
            "Invitation email sent",
            email=email,
            project_name=project_name,
        )

    async def send_project_assignment_email(
        self,
        email: str,
        project_name: str,
        role: str,
        inviter_name: str,
        inviter_email: str,
    ) -> None:
        """
        Send project assignment notification to existing user.

        Args:
            email: User's email address
            project_name: Name of the project they've been added to
            role: Role they're assigned (e.g., 'project-admin', 'project-viewer')
            inviter_name: Name of the person who added them
            inviter_email: Email of the person who added them

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        logger.info(
            "Preparing project assignment email",
            email=email,
            project_name=project_name,
            role=role,
        )

        # Format role for display
        role_display = role.replace('-', ' ').title()

        # Login link
        login_url = f"https://{self.settings.domain_name}/login"

        subject = f"You've been added to {project_name} on AddaxAI Connect"
        body = f"""
Hello!

{inviter_name} ({inviter_email}) has added you to the "{project_name}" project on AddaxAI Connect.

Your assigned role: {role_display}

You can now access this project by logging in:

{login_url}

The project will appear in your projects list once you log in.

If you have any questions, feel free to reach out to {inviter_name} at {inviter_email}.

---
AddaxAI Connect
Realtime camera trap image processing platform
"""

        await self.send_email(email, subject, body)

        logger.info(
            "Project assignment email sent",
            email=email,
            project_name=project_name,
        )


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
