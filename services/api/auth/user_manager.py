"""
Custom UserManager for FastAPI-Users.

Implements:
- Token-based invitation validation
- Email verification
- Password reset
"""
from typing import Optional
from datetime import datetime, timezone
from fastapi import Depends, Request
from fastapi_users import BaseUserManager, IntegerIDMixin, exceptions
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, ProjectMembership, UserInvitation
from shared.database import get_async_session
from shared.config import get_settings
from shared.logger import get_logger
from mailer.sender import get_email_sender


settings = get_settings()
logger = get_logger("api.auth")


class UserManager(IntegerIDMixin, BaseUserManager[User, int]):
    """
    Custom user manager with token-based invitation validation.

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

    async def on_after_register(
        self,
        user: User,
        request: Optional[Request] = None,
    ) -> None:
        """
        Called after user registration.

        Triggers verification email via on_after_request_verify callback,
        unless user is already verified (e.g., via invitation token).

        Args:
            user: Newly registered user
            request: Request object
        """
        # Skip verification email if user is already verified (invitation token registration)
        if not user.is_verified:
            # Request verification - this triggers on_after_request_verify callback
            # which sends the email with the actual token
            await self.request_verify(user, request)

            logger.info(
                "User registered, verification email requested",
                email=user.email,
                user_id=user.id,
                event="user_registration",
            )
        else:
            logger.info(
                "User registered with invitation token (already verified)",
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
        Create a new user with token-based invitation validation.

        Registration requires a valid invitation token that proves:
        - The user has access to the email (token sent to that email)
        - The invitation hasn't expired (7 days)
        - The invitation hasn't been used yet

        The token validation replaces email verification - clicking the invite link
        is proof of email ownership.

        Args:
            user_create: User creation data (must include token)
            safe: If True, validates request came from auth endpoint
            request: Request object

        Returns:
            Created user with is_verified=True

        Raises:
            exceptions.UserAlreadyExists: If email already registered
            exceptions.InvalidPasswordException: If token is invalid, expired, or used
        """
        # Get database session from request state
        db: AsyncSession = request.state.db

        # Extract and validate token
        user_dict = user_create.model_dump()
        token = user_dict.get('token')

        if not token:
            raise exceptions.InvalidPasswordException(
                reason="Registration requires an invitation token. "
                       "Please use the link from your invitation email."
            )

        # Look up invitation by token
        result = await db.execute(
            select(UserInvitation).where(UserInvitation.token == token)
        )
        invitation = result.scalar_one_or_none()

        if not invitation:
            logger.warning(
                "Invalid invitation token during registration",
                token_length=len(token)
            )
            raise exceptions.InvalidPasswordException(
                reason="Invalid invitation token. Please request a new invitation."
            )

        # Check if token has already been used
        if invitation.used:
            logger.warning(
                "Invitation token already used",
                email=invitation.email
            )
            raise exceptions.InvalidPasswordException(
                reason="This invitation has already been used."
            )

        # Check if token has expired
        if invitation.expires_at and invitation.expires_at < datetime.now(timezone.utc):
            logger.warning(
                "Invitation token expired",
                email=invitation.email,
                expired_at=invitation.expires_at.isoformat()
            )
            raise exceptions.InvalidPasswordException(
                reason="This invitation has expired. Please request a new invitation."
            )

        # Validate that email in request matches invitation email
        if user_create.email != invitation.email:
            logger.warning(
                "Email mismatch during registration",
                provided_email=user_create.email,
                invitation_email=invitation.email
            )
            raise exceptions.InvalidPasswordException(
                reason="Email does not match invitation. Please use the email from your invitation."
            )

        # Set is_superuser based on invitation role
        user_dict['is_superuser'] = (invitation.role == 'server-admin')

        # Auto-verify email (invitation token proves email ownership)
        user_dict['is_verified'] = True

        # Remove token before creating User (not part of User model)
        user_dict.pop('token', None)

        # Create new instance with updated fields
        from auth.schemas import UserCreate
        # Use model_construct to bypass validation (token field not needed here)
        user_create_verified = UserCreate.model_construct(**user_dict)

        # Call parent create method with safe=False to allow is_superuser and is_verified
        created_user = await super().create(user_create_verified, safe=False, request=request)

        # Create project membership from invitation if applicable
        if invitation.project_id and invitation.role in ['project-admin', 'project-viewer']:
            membership = ProjectMembership(
                user_id=created_user.id,
                project_id=invitation.project_id,
                role=invitation.role,
                added_by_user_id=invitation.invited_by_user_id
            )
            db.add(membership)

            logger.info(
                "User registered with project invitation - membership created",
                email=created_user.email,
                user_id=created_user.id,
                project_id=invitation.project_id,
                role=invitation.role,
                invited_by=invitation.invited_by_user_id,
                is_verified=True
            )

        # Mark invitation as used (keep for audit trail, don't delete)
        invitation.used = True
        await db.commit()

        logger.info(
            "User created successfully via invitation token",
            email=created_user.email,
            user_id=created_user.id,
            role=invitation.role,
            is_superuser=created_user.is_superuser,
            is_verified=created_user.is_verified,
            project_id=invitation.project_id
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
