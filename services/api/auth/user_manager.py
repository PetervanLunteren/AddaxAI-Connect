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
from fastapi_users.db import SQLAlchemyUserDatabase
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
    ) -> EmailAllowlist | None:
        """
        Check if email is in allowlist and return the entry.

        Checks both specific emails and domain patterns.
        Prioritizes exact email matches over domain matches.

        Args:
            email: Email address to check
            db: Database session

        Returns:
            EmailAllowlist entry if allowed, None otherwise
        """
        # Extract domain from email
        domain = "@" + email.split("@")[1]

        # Check for exact email match first (higher priority)
        result = await db.execute(
            select(EmailAllowlist).where(EmailAllowlist.email == email)
        )
        allowlist_entry = result.scalar_one_or_none()

        # If no exact match, check for domain match
        if not allowlist_entry:
            result = await db.execute(
                select(EmailAllowlist).where(EmailAllowlist.domain == domain)
            )
            allowlist_entry = result.scalar_one_or_none()

        return allowlist_entry

    async def on_after_register(
        self,
        user: User,
        request: Optional[Request] = None,
    ) -> None:
        """
        Called after user registration.

        Triggers verification email via on_after_request_verify callback.

        Args:
            user: Newly registered user
            request: Request object
        """
        # Request verification - this triggers on_after_request_verify callback
        # which sends the email with the actual token
        await self.request_verify(user, request)

        print(f"User {user.email} registered. Verification email requested.")

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
        Create a new user with allowlist validation and role assignment.

        The user's is_superuser flag is set based on the allowlist entry:
        - If allowlist entry has is_superuser=True, user becomes server admin
        - If allowlist entry has is_superuser=False, user is a regular user

        Regular users will get project-specific roles assigned later.

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

        # Check allowlist and get entry
        email = user_create.email
        allowlist_entry = await self._check_allowlist(email, db)

        if not allowlist_entry:
            raise exceptions.InvalidPasswordException(
                reason=f"Email {email} is not in the allowlist. "
                       "Please contact an administrator to request access."
            )

        # Apply is_superuser flag from allowlist entry
        # This determines if user becomes a server admin
        # Must set safe=False to allow is_superuser to be set
        user_create.is_superuser = allowlist_entry.is_superuser

        # Call parent create method with safe=False to allow is_superuser
        created_user = await super().create(user_create, safe=False, request=request)

        return created_user


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    """
    Get user database adapter.

    Duplicated here to avoid circular import with users.py

    Args:
        session: Database session

    Yields:
        SQLAlchemyUserDatabase instance
    """
    yield SQLAlchemyUserDatabase(session, User)


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> UserManager:
    """
    Dependency to get UserManager instance.

    Args:
        user_db: User database adapter

    Yields:
        UserManager instance
    """
    yield UserManager(user_db)
