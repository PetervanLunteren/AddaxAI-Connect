#!/usr/bin/env python3
"""
Create admin invitation with token.

Usage:
    python create_admin_invitation.py

Environment variables required:
    ADMIN_EMAIL - Email address for server admin
    DATABASE_URL - PostgreSQL connection string
    DOMAIN_NAME - Domain name for registration URL
"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
import smtplib
from email.message import EmailMessage

# Add shared module to path
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "api"))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from shared.models import User, UserInvitation
from shared.database import Base


def send_admin_invitation_email(
    to_email: str,
    registration_url: str,
    domain_name: str,
) -> bool:
    """
    Send admin invitation email via SMTP (synchronous).

    Args:
        to_email: Admin email address
        registration_url: Registration URL with token
        domain_name: Domain name

    Returns:
        True if email sent successfully, False otherwise
    """
    # Get email configuration from environment
    mail_server = os.getenv("MAIL_SERVER")
    mail_port = int(os.getenv("MAIL_PORT", "587"))
    mail_username = os.getenv("MAIL_USERNAME")
    mail_password = os.getenv("MAIL_PASSWORD")
    mail_from = os.getenv("MAIL_FROM")

    # Check if email is configured
    if not all([mail_server, mail_username, mail_password, mail_from]):
        print("ℹ️  Email not configured - skipping email send")
        print("   (Set MAIL_SERVER, MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM to enable)")
        return False

    try:
        # Create email message
        msg = EmailMessage()
        msg['Subject'] = f"Server Admin Invitation - AddaxAI Connect"
        msg['From'] = mail_from
        msg['To'] = to_email

        # Email body
        body = f"""
Hello!

You've been invited to become a Server Administrator on AddaxAI Connect.

As a server admin, you will have full access to:
- All projects and camera trap data
- User management and invitations
- System configuration and settings

To accept this invitation and set up your account, click the link below:

{registration_url}

This invitation link is unique to you and will expire in 7 days.

Once registered, you can login at: https://{domain_name}/login

---
AddaxAI Connect
Camera Trap Image Processing Platform
"""
        msg.set_content(body)

        # Send email via SMTP with STARTTLS
        with smtplib.SMTP(mail_server, mail_port, timeout=10) as server:
            server.starttls()
            server.login(mail_username, mail_password)
            server.send_message(msg)

        print(f"✅ Invitation email sent to {to_email}")
        return True

    except Exception as e:
        print(f"⚠️  Failed to send email to {to_email}: {e}")
        print("   The registration URL is still valid - use the console output above")
        return False


def create_admin_invitation(email: str, database_url: str, domain_name: str) -> str:
    """
    Create admin invitation with token.

    Args:
        email: Admin email address
        database_url: PostgreSQL connection string
        domain_name: Domain name for registration URL

    Returns:
        Registration URL with token

    Raises:
        ValueError: If email not provided or database connection fails
    """
    if not email:
        raise ValueError("ADMIN_EMAIL environment variable must be set")

    if not database_url:
        raise ValueError("DATABASE_URL environment variable must be set")

    if not domain_name:
        raise ValueError("DOMAIN_NAME environment variable must be set")

    # Create engine and session
    engine = create_engine(database_url)

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        # Check if user already exists
        result = db.execute(
            select(User).where(User.email == email)
        )
        existing_user = result.scalar_one_or_none()

        if existing_user:
            print(f"✅ Admin user {email} already exists and is registered.")
            print(f"   Status: {'Active' if existing_user.is_active else 'Inactive'}, "
                  f"{'Verified' if existing_user.is_verified else 'Unverified'}, "
                  f"{'Superuser' if existing_user.is_superuser else 'Regular user'}")

            # Make sure they have proper admin privileges
            if not existing_user.is_superuser or not existing_user.is_verified or not existing_user.is_active:
                existing_user.is_superuser = True
                existing_user.is_verified = True
                existing_user.is_active = True
                db.commit()
                print(f"   Updated to server admin with full privileges.")

            return None

        # Check if invitation already exists
        result = db.execute(
            select(UserInvitation).where(UserInvitation.email == email)
        )
        existing_invitation = result.scalar_one_or_none()

        if existing_invitation:
            # Check if it's expired or used
            now = datetime.now(timezone.utc)
            if existing_invitation.used:
                print(f"ℹ️  Invitation for {email} was already used.")
                return None
            elif existing_invitation.expires_at and existing_invitation.expires_at < now:
                # Regenerate token for expired invitation
                import secrets
                new_token = secrets.token_urlsafe(32)
                new_expires_at = datetime.now(timezone.utc) + timedelta(days=7)

                existing_invitation.token = new_token
                existing_invitation.expires_at = new_expires_at
                existing_invitation.used = False
                db.commit()

                registration_url = f"https://{domain_name}/register?token={new_token}"
                print(f"✅ Regenerated expired invitation for {email}")
                print(f"   New registration URL: {registration_url}")
                print(f"   Token expires: {new_expires_at.strftime('%Y-%m-%d %H:%M:%S')} UTC")

                # Try to send email
                send_admin_invitation_email(email, registration_url, domain_name)

                return registration_url
            else:
                # Invitation exists and is still valid
                registration_url = f"https://{domain_name}/register?token={existing_invitation.token}"
                print(f"✅ Valid invitation already exists for {email}")
                print(f"   Registration URL: {registration_url}")
                print(f"   Token expires: {existing_invitation.expires_at.strftime('%Y-%m-%d %H:%M:%S')} UTC")

                # Try to send email (re-send existing invitation)
                send_admin_invitation_email(email, registration_url, domain_name)

                return registration_url

        # Create new invitation
        import secrets
        invite_token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)

        # For admin invitation, we don't have an "invited_by" user yet
        # We'll use a dummy user_id of 1, or create a system user
        # Let's just set invited_by_user_id to None for now and handle it in the model

        # Actually, looking at the model, invited_by_user_id is NOT NULL
        # So we need to handle this. Let's create the invitation without a user_id first
        # by temporarily allowing NULL, or we create a system user

        # Better approach: Create a system user for this purpose
        system_user = db.execute(
            select(User).where(User.email == "system@addaxai.com")
        ).scalar_one_or_none()

        if not system_user:
            # Create system user
            from passlib.context import CryptContext
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

            system_user = User(
                email="system@addaxai.com",
                hashed_password=pwd_context.hash(secrets.token_urlsafe(32)),
                is_active=False,  # System user is not active for login
                is_superuser=True,
                is_verified=True,
            )
            db.add(system_user)
            db.commit()
            db.refresh(system_user)

        invitation = UserInvitation(
            email=email,
            invited_by_user_id=system_user.id,
            role='server-admin',
            project_id=None,
            token=invite_token,
            expires_at=expires_at,
            used=False
        )

        db.add(invitation)
        db.commit()
        db.refresh(invitation)

        registration_url = f"https://{domain_name}/register?token={invite_token}"

        print(f"✅ Admin invitation created for {email}")
        print(f"   Role: server-admin")
        print(f"   Registration URL: {registration_url}")
        print(f"   Token expires: {expires_at.strftime('%Y-%m-%d %H:%M:%S')} UTC (7 days)")

        # Try to send email
        send_admin_invitation_email(email, registration_url, domain_name)

        return registration_url


def main():
    """Main entry point"""
    # Get environment variables
    email = os.getenv("ADMIN_EMAIL")
    database_url = os.getenv("DATABASE_URL")
    domain_name = os.getenv("DOMAIN_NAME")

    if not email:
        print("❌ ERROR: ADMIN_EMAIL environment variable not set")
        print("   Usage: ADMIN_EMAIL=admin@example.com python create_admin_invitation.py")
        sys.exit(1)

    if not database_url:
        print("❌ ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    if not domain_name:
        print("❌ ERROR: DOMAIN_NAME environment variable not set")
        sys.exit(1)

    try:
        registration_url = create_admin_invitation(email, database_url, domain_name)

        if registration_url:
            print()
            print("=" * 80)
            print("IMPORTANT: Save this registration URL!")
            print("=" * 80)
            print(f"URL: {registration_url}")
            print()
            print("The server admin can use this URL to:")
            print("1. Register with their email and chosen password")
            print("2. Gain full access to the system as a server admin")
            print()
            print("This URL will expire in 7 days and can only be used once.")
            print("=" * 80)
    except Exception as e:
        print(f"❌ ERROR: Failed to create admin invitation: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
