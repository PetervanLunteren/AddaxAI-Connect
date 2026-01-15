"""
Admin endpoints for managing email allowlist and Telegram configuration.

Only accessible by superusers.
"""
from typing import List, Optional
from datetime import datetime
import httpx
import base64
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from shared.models import User, EmailAllowlist, Project, TelegramConfig, ProjectMembership, UserInvitation
from shared.database import get_async_session
from shared.config import get_settings
from shared.logger import get_logger
from auth.permissions import require_server_admin
from mailer.sender import get_email_sender

settings = get_settings()
logger = get_logger("api.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AllowlistCreateRequest(BaseModel):
    """Request to add email or domain to allowlist"""
    email: Optional[EmailStr] = None
    domain: Optional[str] = None

    class Config:
        # Ensure at least one is provided
        @staticmethod
        def validate_model(values):
            if not values.get("email") and not values.get("domain"):
                raise ValueError("Either email or domain must be provided")
            return values


class AllowlistResponse(BaseModel):
    """Response for allowlist entry"""
    id: int
    email: Optional[str]
    domain: Optional[str]
    is_superuser: bool
    added_by_user_id: Optional[int]
    created_at: str

    class Config:
        from_attributes = True


class ProjectMembershipInfo(BaseModel):
    """Project membership info for user response"""
    project_id: int
    project_name: str
    role: str


class UserResponse(BaseModel):
    """Response for user with project memberships"""
    id: int
    email: str
    is_active: bool
    is_superuser: bool
    is_verified: bool
    project_memberships: list[ProjectMembershipInfo] = []

    class Config:
        from_attributes = True


class AddUserToProjectRequest(BaseModel):
    """Request to add user to project"""
    project_id: int
    role: str  # 'project-admin' or 'project-viewer'


class UpdateRoleRequest(BaseModel):
    """Request to update user's role in project"""
    role: str  # 'project-admin' or 'project-viewer'


@router.post(
    "/allowlist",
    response_model=AllowlistResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_to_allowlist(
    data: AllowlistCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Add email or domain to allowlist (superuser only).

    Args:
        data: Email or domain to add
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Created allowlist entry

    Raises:
        HTTPException: If email/domain already in allowlist
    """
    # Validate at least one is provided
    if not data.email and not data.domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either email or domain must be provided",
        )

    # Check if already exists
    result = await db.execute(
        select(EmailAllowlist).where(
            (EmailAllowlist.email == data.email) |
            (EmailAllowlist.domain == data.domain)
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or domain already in allowlist",
        )

    # Create new entry
    entry = EmailAllowlist(
        email=data.email,
        domain=data.domain,
        added_by_user_id=current_user.id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    return entry


@router.get(
    "/allowlist",
    response_model=List[AllowlistResponse],
)
async def list_allowlist(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    List all allowlist entries (superuser only).

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        List of allowlist entries
    """
    result = await db.execute(select(EmailAllowlist))
    entries = result.scalars().all()

    return entries


@router.delete(
    "/allowlist/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_from_allowlist(
    entry_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Remove entry from allowlist (superuser only).

    Args:
        entry_id: Allowlist entry ID
        db: Database session
        current_user: Current authenticated superuser

    Raises:
        HTTPException: If entry not found
    """
    result = await db.execute(
        select(EmailAllowlist).where(EmailAllowlist.id == entry_id)
    )
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Allowlist entry not found",
        )

    await db.delete(entry)
    await db.commit()


@router.get(
    "/users",
    response_model=List[UserResponse],
)
async def list_users(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    List all users with their project memberships (server admin only)

    Returns list of all users including their project memberships with roles.

    Args:
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        List of users with project memberships
    """
    # Get all users
    result = await db.execute(select(User))
    users = result.scalars().all()

    # Build responses with project memberships
    responses = []
    for user in users:
        # Get user's project memberships
        memberships_result = await db.execute(
            select(ProjectMembership, Project).join(
                Project, ProjectMembership.project_id == Project.id
            ).where(ProjectMembership.user_id == user.id)
        )
        memberships = memberships_result.all()

        # Build membership info list
        membership_info = [
            ProjectMembershipInfo(
                project_id=membership.ProjectMembership.project_id,
                project_name=membership.Project.name,
                role=membership.ProjectMembership.role
            )
            for membership in memberships
        ]

        responses.append(UserResponse(
            id=user.id,
            email=user.email,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            is_verified=user.is_verified,
            project_memberships=membership_info
        ))

    return responses


@router.get(
    "/users/{user_id}/projects",
    response_model=list[ProjectMembershipInfo],
)
async def get_user_projects(
    user_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Get all project memberships for a user (server admin only)

    Args:
        user_id: User ID
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        List of project memberships

    Raises:
        HTTPException 404: User not found
    """
    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found"
        )

    # Get user's project memberships
    memberships_result = await db.execute(
        select(ProjectMembership, Project).join(
            Project, ProjectMembership.project_id == Project.id
        ).where(ProjectMembership.user_id == user_id)
    )
    memberships = memberships_result.all()

    return [
        ProjectMembershipInfo(
            project_id=membership.ProjectMembership.project_id,
            project_name=membership.Project.name,
            role=membership.ProjectMembership.role
        )
        for membership in memberships
    ]


@router.post(
    "/users/{user_id}/projects",
    response_model=ProjectMembershipInfo,
    status_code=status.HTTP_201_CREATED,
)
async def add_user_to_project(
    user_id: int,
    data: AddUserToProjectRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Add user to project with role (server admin only)

    Args:
        user_id: User ID
        data: Project ID and role
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        Created project membership

    Raises:
        HTTPException 404: User or project not found
        HTTPException 409: User already in project
        HTTPException 400: Invalid role
    """
    # Validate role
    valid_roles = ['project-admin', 'project-viewer']
    if data.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )

    # Verify user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found"
        )

    # Verify project exists
    project_result = await db.execute(select(Project).where(Project.id == data.project_id))
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {data.project_id} not found"
        )

    # Check if membership already exists
    existing = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == data.project_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User already assigned to project {data.project_id}"
        )

    # Create membership
    membership = ProjectMembership(
        user_id=user_id,
        project_id=data.project_id,
        role=data.role,
        added_by_user_id=current_user.id
    )
    db.add(membership)
    await db.commit()

    return ProjectMembershipInfo(
        project_id=project.id,
        project_name=project.name,
        role=data.role
    )


@router.patch(
    "/users/{user_id}/projects/{project_id}",
    response_model=ProjectMembershipInfo,
)
async def update_user_project_role(
    user_id: int,
    project_id: int,
    data: UpdateRoleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Change user's role in specific project (server admin only)

    Args:
        user_id: User ID
        project_id: Project ID
        data: New role
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        Updated project membership

    Raises:
        HTTPException 404: Membership not found
        HTTPException 400: Invalid role
    """
    # Validate role
    valid_roles = ['project-admin', 'project-viewer']
    if data.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )

    # Get membership
    membership_result = await db.execute(
        select(ProjectMembership, Project).join(
            Project, ProjectMembership.project_id == Project.id
        ).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == project_id
        )
    )
    membership_data = membership_result.first()

    if not membership_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found in project {project_id}"
        )

    membership, project = membership_data

    # Update role
    membership.role = data.role
    await db.commit()

    return ProjectMembershipInfo(
        project_id=project.id,
        project_name=project.name,
        role=data.role
    )


@router.delete(
    "/users/{user_id}/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_user_from_project(
    user_id: int,
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Remove user from project (server admin only)

    If user has no other project memberships and is not a server admin,
    this will effectively remove all their access.

    Args:
        user_id: User ID
        project_id: Project ID
        db: Database session
        current_user: Current authenticated server admin

    Raises:
        HTTPException 404: Membership not found
    """
    # Get membership
    membership_result = await db.execute(
        select(ProjectMembership).where(
            ProjectMembership.user_id == user_id,
            ProjectMembership.project_id == project_id
        )
    )
    membership = membership_result.scalar_one_or_none()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found in project {project_id}"
        )

    # Delete membership
    await db.delete(membership)
    await db.commit()


# User Invitation Endpoints

class InviteUserRequest(BaseModel):
    """Request to invite a new user (server admin only)"""
    email: EmailStr
    role: str  # 'server-admin' or 'project-admin'
    project_id: Optional[int] = None  # Required for project-admin, ignored for server-admin
    send_email: bool = False  # Whether to send invitation email


class InvitationResponse(BaseModel):
    """Response for invitation"""
    email: str
    role: str
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    email_sent: bool  # Whether invitation email was sent
    message: str


@router.post(
    "/users/invite",
    response_model=InvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_user(
    data: InviteUserRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Invite a new user (server admin only)

    This creates an allowlist entry and pending invitation. When the user registers,
    they will automatically be assigned to the specified project with the specified role.

    For server-admin role: project_id is ignored, user becomes server admin
    For project-admin role: project_id is required, user becomes project admin in that project

    Args:
        data: Email, role, and optional project_id
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        Invitation details

    Raises:
        HTTPException 400: Invalid role or missing project_id for project-admin
        HTTPException 404: Project not found
        HTTPException 409: User already exists or invitation already sent
    """
    # Validate role
    valid_roles = ['server-admin', 'project-admin']
    if data.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )

    # Validate project_id for project-admin
    if data.role == 'project-admin' and not data.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id is required for project-admin role"
        )

    # Check if user already exists
    existing_user = await db.execute(select(User).where(User.email == data.email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email {data.email} already exists"
        )

    # Check if invitation already exists
    existing_invitation = await db.execute(
        select(UserInvitation).where(UserInvitation.email == data.email)
    )
    if existing_invitation.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invitation already sent to {data.email}"
        )

    # Verify project exists for project-admin
    project = None
    if data.role == 'project-admin':
        project_result = await db.execute(
            select(Project).where(Project.id == data.project_id)
        )
        project = project_result.scalar_one_or_none()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project with ID {data.project_id} not found"
            )

    # Add to allowlist
    is_superuser = data.role == 'server-admin'
    allowlist_entry = EmailAllowlist(
        email=data.email,
        is_superuser=is_superuser,
        added_by_user_id=current_user.id
    )
    db.add(allowlist_entry)

    # Create invitation with role and project_id
    invitation = UserInvitation(
        email=data.email,
        invited_by_user_id=current_user.id,
        project_id=data.project_id if data.role == 'project-admin' else None,
        role=data.role
    )
    db.add(invitation)

    await db.commit()

    # Send invitation email if requested
    email_sent = False
    if data.send_email:
        try:
            email_sender = get_email_sender()
            # For server-admin invitations, use a generic project name
            project_name = project.name if project else "AddaxAI Connect"
            await email_sender.send_invitation_email(
                email=data.email,
                project_name=project_name,
                role=data.role,
                inviter_name=current_user.email,  # Using email as name for now
                inviter_email=current_user.email,
            )
            email_sent = True
            logger.info(
                "Invitation email sent successfully",
                email=data.email,
                role=data.role,
            )
        except Exception as e:
            logger.error(
                "Failed to send invitation email",
                email=data.email,
                role=data.role,
                error=str(e),
                exc_info=True,
            )
            # Don't fail the invitation creation if email fails

    message = f"Invitation sent to {data.email}. They can now register and will be assigned as {data.role}."
    if email_sent:
        message += " (invitation email sent)"

    return InvitationResponse(
        email=data.email,
        role=data.role,
        project_id=data.project_id if project else None,
        project_name=project.name if project else None,
        email_sent=email_sent,
        message=message
    )


class AddServerAdminRequest(BaseModel):
    """Request to add a server admin (unified invite/promote)"""
    email: EmailStr
    send_email: bool = False  # Whether to send notification email


class AddServerAdminResponse(BaseModel):
    """Response for adding server admin"""
    email: str
    was_promoted: bool  # True if existing user promoted, False if new invitation created
    email_sent: bool  # Whether notification email was sent
    message: str


@router.post(
    "/server-admins/add",
    response_model=AddServerAdminResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_server_admin(
    data: AddServerAdminRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Add a server admin - unified endpoint that handles both new invitations and promoting existing users.

    If the email already exists in the database, the user is promoted to server admin.
    If the email is new, an invitation is created.

    Args:
        data: Email and send_email flag
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        Details about whether user was promoted or invited

    Raises:
        HTTPException 409: If user is already a server admin or invitation already exists
    """
    # Check if user already exists
    existing_user_result = await db.execute(select(User).where(User.email == data.email))
    existing_user = existing_user_result.scalar_one_or_none()

    email_sent = False

    if existing_user:
        # User exists - promote to server admin
        if existing_user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{data.email} is already a server admin"
            )

        # Promote user to server admin
        existing_user.is_superuser = True
        await db.commit()

        # Send promotion email if requested
        if data.send_email:
            try:
                email_sender = get_email_sender()
                await email_sender.send_server_admin_promotion_email(
                    email=data.email,
                    promoter_email=current_user.email,
                )
                email_sent = True
                logger.info(
                    "Server admin promotion email sent",
                    email=data.email,
                )
            except Exception as e:
                logger.error(
                    "Failed to send server admin promotion email",
                    email=data.email,
                    error=str(e),
                    exc_info=True,
                )
                # Don't fail the promotion if email fails

        message = f"{data.email} has been promoted to server admin."
        if email_sent:
            message += " (notification email sent)"

        return AddServerAdminResponse(
            email=data.email,
            was_promoted=True,
            email_sent=email_sent,
            message=message
        )
    else:
        # User doesn't exist - create invitation
        # Check if invitation already exists
        existing_invitation = await db.execute(
            select(UserInvitation).where(UserInvitation.email == data.email)
        )
        if existing_invitation.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Invitation already sent to {data.email}"
            )

        # Add to allowlist
        allowlist_entry = EmailAllowlist(
            email=data.email,
            is_superuser=True,
            added_by_user_id=current_user.id
        )
        db.add(allowlist_entry)

        # Create invitation
        invitation = UserInvitation(
            email=data.email,
            invited_by_user_id=current_user.id,
            project_id=None,
            role='server-admin'
        )
        db.add(invitation)

        await db.commit()

        # Send invitation email if requested
        if data.send_email:
            try:
                email_sender = get_email_sender()
                await email_sender.send_invitation_email(
                    email=data.email,
                    project_name="AddaxAI Connect",
                    role='server-admin',
                    inviter_name=current_user.email,
                    inviter_email=current_user.email,
                )
                email_sent = True
                logger.info(
                    "Server admin invitation email sent",
                    email=data.email,
                )
            except Exception as e:
                logger.error(
                    "Failed to send server admin invitation email",
                    email=data.email,
                    error=str(e),
                    exc_info=True,
                )
                # Don't fail the invitation if email fails

        message = f"Invitation sent to {data.email}. They can now register as a server admin."
        if email_sent:
            message += " (invitation email sent)"

        return AddServerAdminResponse(
            email=data.email,
            was_promoted=False,
            email_sent=email_sent,
            message=message
        )


# Telegram Bot Configuration Endpoints

class TelegramConfigResponse(BaseModel):
    """Response for Telegram bot configuration"""
    bot_token: Optional[str]
    bot_username: Optional[str]
    is_configured: bool
    last_health_check: Optional[datetime]
    health_status: Optional[str]

    class Config:
        from_attributes = True


class TelegramConfigureRequest(BaseModel):
    """Request to configure Telegram bot"""
    bot_token: str  # From @BotFather
    bot_username: str  # e.g., "AddaxAI_bot"


@router.get(
    "/telegram/config",
    response_model=TelegramConfigResponse,
)
async def get_telegram_config(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Get Telegram bot configuration (superuser only).

    Returns the Telegram bot configuration including health check information.

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Telegram bot configuration

    Raises:
        HTTPException 404: If Telegram config not initialized
    """
    result = await db.execute(select(TelegramConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Telegram not configured. Use POST /api/admin/telegram/configure to set up Telegram bot."
        )

    return config


@router.post(
    "/telegram/configure",
    response_model=TelegramConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def configure_telegram(
    data: TelegramConfigureRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Configure Telegram bot (superuser only).

    Steps to get bot token:
    1. Open Telegram and search for @BotFather
    2. Send /newbot command
    3. Follow prompts to name your bot
    4. Copy the bot token provided
    5. Copy the bot username (e.g., "AddaxAI_bot")
    6. Paste both here

    Args:
        data: Bot token and username
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Created/updated Telegram configuration

    Raises:
        HTTPException 400: If bot token is invalid
    """
    # Verify token works by calling getMe
    test_url = f"https://api.telegram.org/bot{data.bot_token}/getMe"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(test_url, timeout=10)

            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid bot token. Please check and try again."
                )

            # Verify username matches
            bot_info = response.json()
            if bot_info.get('ok'):
                actual_username = bot_info.get('result', {}).get('username')
                if actual_username and actual_username.lower() != data.bot_username.lower().replace('@', ''):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Bot username mismatch. Expected @{actual_username}, got @{data.bot_username}"
                    )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to Telegram API: {str(e)}"
        )

    # Create or update config
    result = await db.execute(select(TelegramConfig))
    config = result.scalar_one_or_none()

    if config:
        config.bot_token = data.bot_token
        config.bot_username = data.bot_username
        config.is_configured = True
        config.health_status = "healthy"
        config.last_health_check = datetime.utcnow()
    else:
        config = TelegramConfig(
            bot_token=data.bot_token,
            bot_username=data.bot_username,
            is_configured=True,
            health_status="healthy",
            last_health_check=datetime.utcnow()
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)

    return config


@router.delete(
    "/telegram",
    status_code=status.HTTP_200_OK,
)
async def unconfigure_telegram(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Remove Telegram bot configuration (superuser only).

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Success message
    """
    result = await db.execute(select(TelegramConfig))
    config = result.scalar_one_or_none()

    if config:
        await db.delete(config)
        await db.commit()

    return {"message": "Telegram bot configuration removed"}


@router.get(
    "/telegram/health",
    status_code=status.HTTP_200_OK,
)
async def check_telegram_health(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Check if Telegram bot is healthy (superuser only).

    Calls Telegram Bot API /getMe endpoint to verify bot is accessible.

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Health status

    Raises:
        HTTPException 404: If Telegram not configured
        HTTPException 500: If health check fails
    """
    result = await db.execute(select(TelegramConfig))
    config = result.scalar_one_or_none()

    if not config or not config.is_configured:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Telegram not configured"
        )

    # Test API call
    test_url = f"https://api.telegram.org/bot{config.bot_token}/getMe"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(test_url, timeout=5)
            response.raise_for_status()

            # Update health status
            config.last_health_check = datetime.utcnow()
            config.health_status = "healthy"
            await db.commit()

            bot_info = response.json()
            return {
                "status": "healthy",
                "message": "Telegram bot is working",
                "bot_info": bot_info.get('result', {})
            }

    except Exception as e:
        config.health_status = "error"
        config.last_health_check = datetime.utcnow()
        await db.commit()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Health check failed: {str(e)}"
        )


class TelegramSendTestMessageRequest(BaseModel):
    """Request to send test Telegram message"""
    chat_id: str  # Telegram chat ID
    message: Optional[str] = "Test message from AddaxAI Connect! Your Telegram notifications are working."


@router.post(
    "/telegram/test-message",
    status_code=status.HTTP_200_OK,
)
async def send_telegram_test_message(
    data: TelegramSendTestMessageRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Send test message to verify Telegram bot works (superuser only).

    Args:
        data: Chat ID and optional message text
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Success message

    Raises:
        HTTPException 404: If Telegram not configured
        HTTPException 400: If sending fails
    """
    result = await db.execute(select(TelegramConfig))
    config = result.scalar_one_or_none()

    if not config or not config.is_configured:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Telegram not configured"
        )

    # Send test message
    send_url = f"https://api.telegram.org/bot{config.bot_token}/sendMessage"

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                send_url,
                json={
                    'chat_id': data.chat_id,
                    'text': data.message
                },
                timeout=10
            )

            if response.status_code != 200:
                error_data = response.json()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to send message: {error_data.get('description', 'Unknown error')}"
                )

        return {"message": "Test message sent successfully"}

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to Telegram API: {str(e)}"
        )
