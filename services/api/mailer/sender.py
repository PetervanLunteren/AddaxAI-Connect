"""
Email sender using SMTP via aiosmtplib.

Sends verification, password reset, and invitation emails.
Crashes loudly if email configuration is missing.
"""
import aiosmtplib
from email.message import EmailMessage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from shared.config import get_settings
from shared.logger import get_logger
from shared.email_renderer import render_email

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
        body_text: str,
        body_html: Optional[str] = None,
    ) -> None:
        """
        Send email via SMTP.

        Args:
            to_email: Recipient email address
            subject: Email subject line
            body_text: Email body (plain text)
            body_html: Email body (HTML, optional)

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
            has_html=body_html is not None,
        )

        try:
            if body_html:
                # Multipart message with HTML and text alternatives
                message = MIMEMultipart("alternative")
                message["From"] = self.settings.mail_from
                message["To"] = to_email
                message["Subject"] = subject

                # Attach plain text first (fallback)
                part_text = MIMEText(body_text, "plain", "utf-8")
                message.attach(part_text)

                # Attach HTML (preferred)
                part_html = MIMEText(body_html, "html", "utf-8")
                message.attach(part_html)
            else:
                # Plain text only
                message = EmailMessage()
                message["From"] = self.settings.mail_from
                message["To"] = to_email
                message["Subject"] = subject
                message.set_content(body_text)

            # Auto-detect TLS mode based on port
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

        html_content, text_content = render_email(
            "email_verification.html",
            verification_url=verification_url,
            expiry_hours=24,
        )

        subject = "AddaxAI Connect - Verify Your Email"
        await self.send_email(email, subject, text_content, html_content)

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

        html_content, text_content = render_email(
            "password_reset.html",
            reset_url=reset_url,
            expiry_hours=1,
        )

        subject = "AddaxAI Connect - Password Reset"
        await self.send_email(email, subject, text_content, html_content)

        logger.info(
            "Password reset email sent",
            email=email,
        )

    async def send_invitation_email(
        self,
        email: str,
        token: str,
        project_name: str,
        role: str,
        inviter_name: str,
        inviter_email: str,
    ) -> None:
        """
        Send project invitation email with secure token.

        Args:
            email: Invited user's email address
            token: Secure invitation token (URL-safe)
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
            token_length=len(token)
        )

        # Format role for display
        role_display = role.replace('-', ' ').title()

        # Registration link with secure token
        registration_url = f"https://{self.settings.domain_name}/register?token={token}"

        html_content, text_content = render_email(
            "project_invitation.html",
            project_name=project_name,
            role=role_display,
            inviter_email=inviter_email,
            registration_url=registration_url,
            expiry_days=7,
        )

        subject = f"You've been invited to join {project_name} on AddaxAI Connect"
        await self.send_email(email, subject, text_content, html_content)

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

        html_content, text_content = render_email(
            "project_assignment.html",
            project_name=project_name,
            role=role_display,
            inviter_email=inviter_email,
            login_url=login_url,
        )

        subject = f"You've been added to {project_name} on AddaxAI Connect"
        await self.send_email(email, subject, text_content, html_content)

        logger.info(
            "Project assignment email sent",
            email=email,
            project_name=project_name,
        )

    async def send_server_admin_promotion_email(
        self,
        email: str,
        promoter_email: str,
    ) -> None:
        """
        Send server admin promotion notification to existing user.

        Args:
            email: User's email address
            promoter_email: Email of the admin who granted server admin status

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        logger.info(
            "Preparing server admin promotion email",
            email=email,
        )

        # Login link
        login_url = f"https://{self.settings.domain_name}/login"

        html_content, text_content = render_email(
            "server_admin_promotion.html",
            promoter_email=promoter_email,
            login_url=login_url,
        )

        subject = "You've been promoted to Server Admin on AddaxAI Connect"
        await self.send_email(email, subject, text_content, html_content)

        logger.info(
            "Server admin promotion email sent",
            email=email,
        )

    async def send_server_admin_invitation_email(
        self,
        email: str,
        token: str,
        inviter_email: str,
    ) -> None:
        """
        Send server admin invitation email with secure token.

        Args:
            email: Invited user's email address
            token: Secure invitation token (URL-safe)
            inviter_email: Email of the admin who sent the invitation

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        logger.info(
            "Preparing server admin invitation email",
            email=email,
            token_length=len(token)
        )

        # Registration link with secure token
        registration_url = f"https://{self.settings.domain_name}/register?token={token}"

        html_content, text_content = render_email(
            "server_admin_invitation.html",
            inviter_email=inviter_email,
            registration_url=registration_url,
            expiry_days=7,
        )

        subject = "You've been invited as Server Admin on AddaxAI Connect"
        await self.send_email(email, subject, text_content, html_content)

        logger.info(
            "Server admin invitation email sent",
            email=email,
        )

    async def send_project_role_change_email(
        self,
        email: str,
        project_name: str,
        old_role: str,
        new_role: str,
        changer_email: str,
    ) -> None:
        """
        Send project role change notification to user.

        Args:
            email: User's email address
            project_name: Name of the project
            old_role: Previous role (e.g., 'project-viewer')
            new_role: New role (e.g., 'project-admin')
            changer_email: Email of the admin who changed the role

        Raises:
            aiosmtplib.SMTPException: If email sending fails
        """
        logger.info(
            "Preparing role change email",
            email=email,
            project_name=project_name,
            old_role=old_role,
            new_role=new_role,
        )

        # Format roles for display
        old_role_display = old_role.replace('-', ' ').title()
        new_role_display = new_role.replace('-', ' ').title()

        # Login link
        login_url = f"https://{self.settings.domain_name}/login"

        html_content, text_content = render_email(
            "project_role_change.html",
            project_name=project_name,
            old_role=old_role_display,
            new_role=new_role_display,
            changer_email=changer_email,
            login_url=login_url,
        )

        subject = f"Your role in {project_name} has been updated"
        await self.send_email(email, subject, text_content, html_content)

        logger.info(
            "Role change email sent",
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
