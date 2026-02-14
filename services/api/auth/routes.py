"""
Authentication routes using FastAPI-Users.

Provides endpoints for:
- Registration
- Login/logout
- Email verification
- Password reset
- Invitation token validation
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from .users import fastapi_users, auth_backend, current_verified_user
from .schemas import UserRead, UserCreate, UserUpdate
from .user_manager import UserManager, get_user_manager
from shared.models import User, UserInvitation, Project
from shared.database import get_async_session
from shared.logger import get_logger

logger = get_logger("api.auth")


class ChangePasswordRequest(BaseModel):
    """Request body for changing password"""
    current_password: str
    new_password: str


class InviteTokenValidationResponse(BaseModel):
    """Response for invite token validation"""
    email: str
    role: str
    project_name: str | None = None


def get_auth_router() -> APIRouter:
    """
    Get authentication router with all auth endpoints.

    Returns:
        APIRouter with auth routes
    """
    router = APIRouter()

    # Login/logout routes (POST /auth/login, POST /auth/logout)
    router.include_router(
        fastapi_users.get_auth_router(auth_backend),
        prefix="/auth",
        tags=["auth"],
    )

    # Registration route (POST /auth/register)
    router.include_router(
        fastapi_users.get_register_router(UserRead, UserCreate),
        prefix="/auth",
        tags=["auth"],
    )

    # Email verification routes (POST /auth/request-verify-token, POST /auth/verify)
    router.include_router(
        fastapi_users.get_verify_router(UserRead),
        prefix="/auth",
        tags=["auth"],
    )

    # Password reset routes (POST /auth/forgot-password, POST /auth/reset-password)
    router.include_router(
        fastapi_users.get_reset_password_router(),
        prefix="/auth",
        tags=["auth"],
    )

    # User management routes (GET /users/me, PATCH /users/me, etc.)
    router.include_router(
        fastapi_users.get_users_router(UserRead, UserUpdate),
        prefix="/users",
        tags=["users"],
    )

    # Custom change password endpoint
    @router.post("/auth/change-password", tags=["auth"])
    async def change_password(
        request_body: ChangePasswordRequest,
        user: User = Depends(current_verified_user),
        user_manager: UserManager = Depends(get_user_manager),
    ):
        """
        Change password for authenticated user.

        Requires the current password for verification before setting a new one.
        """
        # Verify current password
        verified, _ = user_manager.password_helper.verify_and_update(
            request_body.current_password, user.hashed_password
        )
        if not verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect current password",
            )

        # Validate new password
        try:
            await user_manager.validate_password(request_body.new_password, user)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=e.reason if hasattr(e, "reason") else str(e),
            )

        # Hash and update
        hashed = user_manager.password_helper.hash(request_body.new_password)
        await user_manager.user_db.update(user, {"hashed_password": hashed})

        logger.info(
            "Password changed successfully",
            user_id=user.id,
            email=user.email,
        )

        return {"message": "Password changed"}

    # Custom invitation token validation endpoint
    @router.get(
        "/auth/invite/validate",
        response_model=InviteTokenValidationResponse,
        tags=["auth"],
    )
    async def validate_invite_token(
        token: str,
        db: AsyncSession = Depends(get_async_session),
    ):
        """
        Validate invitation token and return associated email and role.

        This endpoint checks if an invitation token is valid (exists, not expired, not used)
        and returns the associated email address and role. Used by the registration page
        to pre-fill the email field and verify the invitation is valid.

        Args:
            token: Invitation token from email link
            db: Database session

        Returns:
            Email address, role, and project name associated with the token

        Raises:
            HTTPException 404: Token not found
            HTTPException 410: Token expired or already used
        """
        logger.info(
            "Validating invitation token",
            token_length=len(token) if token else 0
        )

        # Look up invitation by token
        result = await db.execute(
            select(UserInvitation).where(UserInvitation.token == token)
        )
        invitation = result.scalar_one_or_none()

        if not invitation:
            logger.warning(
                "Invitation token not found",
                token_length=len(token) if token else 0
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Invalid invitation token"
            )

        # Check if token has already been used
        if invitation.used:
            logger.warning(
                "Invitation token already used",
                email=invitation.email
            )
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invitation has already been used"
            )

        # Check if token has expired
        if invitation.expires_at and invitation.expires_at < datetime.now(timezone.utc):
            logger.warning(
                "Invitation token expired",
                email=invitation.email,
                expired_at=invitation.expires_at.isoformat()
            )
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invitation has expired. Please request a new one."
            )

        # Get project name if this is a project invitation
        project_name = None
        if invitation.project_id:
            project_result = await db.execute(
                select(Project).where(Project.id == invitation.project_id)
            )
            project = project_result.scalar_one_or_none()
            if project:
                project_name = project.name

        logger.info(
            "Invitation token validated successfully",
            email=invitation.email,
            role=invitation.role,
            project_name=project_name
        )

        return InviteTokenValidationResponse(
            email=invitation.email,
            role=invitation.role,
            project_name=project_name
        )

    return router
