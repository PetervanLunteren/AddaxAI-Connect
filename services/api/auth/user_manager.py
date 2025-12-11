"""
Custom UserManager for FastAPI-Users.

Implements:
- Email allowlist validation
- Email verification
- Password reset
"""
from typing import Optional
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, IntegerIDMixin, exceptions
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, EmailAllowlist
from shared.database import get_async_session
from shared.config import get_settings
from mailer.sender import get_email_sender


settings = get_settings()


class UserManager(IntegerIDMixin, BaseUserManager[User, int]):
    """
    Custom user manager with allowlist validation.

    Crashes loudly on misconfiguration.
    """
    reset_password_token_secret = settings.jwt_secret
    verification_token_secret = settings.jwt_secret

    async def validate_password(
        self,
        password: str,
        user: User | dict,
    ) -> None:
        """
        Validate password meets minimum requirements.

        Args:
            password: Plain text password
            user: User instance or dict

        Raises:
            exceptions.InvalidPasswordException: If password is invalid
        """
        if len(password) < 8:
            raise exceptions.InvalidPasswordException(
                reason="Password must be at least 8 characters"
            )

    async def _check_allowlist(
        self,
        email: str,
        db: AsyncSession,
    ) -> bool:
        """
        Check if email is in allowlist.

        Checks both specific emails and domain patterns.

        Args:
            email: Email address to check
            db: Database session

        Returns:
            True if email is allowed, False otherwise
        """
        # Extract domain from email
        domain = "@" + email.split("@")[1]

        # Check for exact email match or domain match
        result = await db.execute(
            select(EmailAllowlist).where(
                (EmailAllowlist.email == email) |
                (EmailAllowlist.domain == domain)
            )
        )
        allowlist_entry = result.scalar_one_or_none()

        return allowlist_entry is not None

    async def on_after_register(
        self,
        user: User,
        request: Optional[Request] = None,
    ) -> None:
        """
        Called after user registration.

        Sends verification email.

        Args:
            user: Newly registered user
            request: Request object
        """
        # Generate verification token
        token = await self.request_verify(user, request)

        # Send verification email
        email_sender = get_email_sender()
        await email_sender.send_verification_email(user.email, token)

        print(f"User {user.email} registered. Verification email sent.")

    async def on_after_forgot_password(
        self,
        user: User,
        token: str,
        request: Optional[Request] = None,
    ) -> None:
        """
        Called after password reset requested.

        Sends password reset email.

        Args:
            user: User requesting password reset
            token: Reset token
            request: Request object
        """
        email_sender = get_email_sender()
        await email_sender.send_password_reset_email(user.email, token)

        print(f"Password reset requested for {user.email}")

    async def on_after_request_verify(
        self,
        user: User,
        token: str,
        request: Optional[Request] = None,
    ) -> None:
        """
        Called after verification email requested.

        Sends verification email.

        Args:
            user: User requesting verification
            token: Verification token
            request: Request object
        """
        email_sender = get_email_sender()
        await email_sender.send_verification_email(user.email, token)

        print(f"Verification email requested for {user.email}")

    async def create(
        self,
        user_create: dict,
        safe: bool = False,
        request: Optional[Request] = None,
    ) -> User:
        """
        Create a new user with allowlist validation.

        Args:
            user_create: User creation data
            safe: If True, validates request came from auth endpoint
            request: Request object

        Returns:
            Created user

        Raises:
            exceptions.UserAlreadyExists: If email already registered
            exceptions.InvalidPasswordException: If email not in allowlist
        """
        # Get database session from request state
        db: AsyncSession = request.state.db

        # Check allowlist
        email = user_create.get("email")
        if not await self._check_allowlist(email, db):
            raise exceptions.InvalidPasswordException(
                reason=f"Email {email} is not in the allowlist. "
                       "Please contact an administrator to request access."
            )

        # Call parent create method
        return await super().create(user_create, safe, request)


async def get_user_manager(
    db: AsyncSession = Depends(get_async_session),
) -> UserManager:
    """
    Dependency to get UserManager instance.

    Args:
        db: Database session

    Yields:
        UserManager instance
    """
    yield UserManager(db)
