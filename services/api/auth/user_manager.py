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

from shared.models import User, EmailAllowlist, ProjectMembership
from shared.database import get_async_session
from shared.config import get_settings
from shared.logger import get_logger
from mailer.sender import get_email_sender


settings = get_settings()
logger = get_logger("api.auth")


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

        logger.info(
            "User registered, verification email requested",
            email=user.email,
            user_id=user.id,
            event="user_registration",
        )

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
        logger.info(
            "on_after_forgot_password callback triggered",
            email=user.email,
            user_id=user.id,
            token_length=len(token) if token else 0,
        )

        try:
            email_sender = get_email_sender()
            await email_sender.send_password_reset_email(user.email, token)

            logger.info(
                "Password reset email sent successfully",
                email=user.email,
                user_id=user.id,
                event="password_reset_requested",
            )
        except Exception as e:
            logger.error(
                "Failed to send password reset email",
                email=user.email,
                user_id=user.id,
                error=str(e),
                error_type=type(e).__name__,
                exc_info=True,
            )
            # Re-raise to ensure the error is not silently swallowed
            raise

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

        logger.info(
            "Verification email requested",
            email=user.email,
            user_id=user.id,
            event="email_verification_requested",
        )

    async def create(
        self,
        user_create: dict,
        safe: bool = False,
        request: Optional[Request] = None,
    ) -> User:
        """
        Create a new user with allowlist validation and project membership enforcement.

        The user's is_server_admin flag is set based on the allowlist entry:
        - If allowlist entry has is_server_admin=True, user becomes server admin
        - If allowlist entry has is_server_admin=False, user is a regular user

        Regular users MUST have at least one project membership pre-created
        by an admin before they can register. This enforces explicit access control.

        Server admins have implicit access to all projects and do not need
        project memberships.

        Args:
            user_create: User creation data
            safe: If True, validates request came from auth endpoint
            request: Request object

        Returns:
            Created user

        Raises:
            exceptions.UserAlreadyExists: If email already registered
            exceptions.InvalidPasswordException: If email not in allowlist
            ValueError: If non-admin user has no project memberships
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
        # Create a new UserCreate instance with is_superuser field
        # (maps to is_server_admin in database via User model property)
        user_dict = user_create.model_dump()
        user_dict['is_superuser'] = allowlist_entry.is_server_admin

        # Create new instance with is_superuser
        from auth.schemas import UserCreate
        user_create_with_admin = UserCreate(**user_dict)

        # Call parent create method with safe=False to allow is_superuser
        # The is_superuser field maps to is_server_admin in the database
        created_user = await super().create(user_create_with_admin, safe=False, request=request)

        # Validate non-admin users have project memberships
        # This enforces "crash early and loudly" - if admin forgot to assign
        # projects, registration fails immediately rather than creating an
        # orphaned user with no access.
        if not created_user.is_server_admin:
            result = await db.execute(
                select(ProjectMembership).where(
                    ProjectMembership.user_id == created_user.id
                )
            )
            memberships = result.scalars().all()

            if not memberships:
                # CRASH - This is a configuration error by the admin
                # User was added to allowlist but no project memberships were created
                await db.delete(created_user)  # Rollback user creation
                await db.commit()

                raise ValueError(
                    f"User {email} has no project memberships. "
                    "An administrator must assign at least one project (with role) "
                    "before this user can register. "
                    "Contact your administrator to request project access."
                )

            logger.info(
                "User created with project memberships",
                email=created_user.email,
                user_id=created_user.id,
                membership_count=len(memberships),
                projects=[m.project_id for m in memberships],
                roles=[m.role for m in memberships]
            )
        else:
            logger.info(
                "Server admin user created",
                email=created_user.email,
                user_id=created_user.id,
                is_server_admin=True
            )

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
