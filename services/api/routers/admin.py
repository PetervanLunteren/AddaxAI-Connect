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

from shared.models import User, EmailAllowlist, Project, TelegramConfig
from shared.database import get_async_session
from shared.config import get_settings
from auth.users import current_superuser

settings = get_settings()


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
    added_by_user_id: Optional[int]
    created_at: str

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    """Response for user with project assignment"""
    id: int
    email: str
    is_active: bool
    is_superuser: bool
    is_verified: bool
    role: Optional[str] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None

    class Config:
        from_attributes = True


class AssignUserToProjectRequest(BaseModel):
    """Request to assign user to project"""
    project_id: Optional[int] = None  # None = unassign


@router.post(
    "/allowlist",
    response_model=AllowlistResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_to_allowlist(
    data: AllowlistCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
):
    """
    List all users with their project assignments (superuser only)

    Returns list of all users including their assigned project information.

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        List of users with project assignments
    """
    # Get all users with their projects (if assigned)
    result = await db.execute(select(User))
    users = result.scalars().all()

    # Build responses with project names
    responses = []
    for user in users:
        project_name = None
        if user.project_id:
            # Get project name
            project_result = await db.execute(
                select(Project).where(Project.id == user.project_id)
            )
            project = project_result.scalar_one_or_none()
            if project:
                project_name = project.name

        responses.append(UserResponse(
            id=user.id,
            email=user.email,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            is_verified=user.is_verified,
            role=user.role,
            project_id=user.project_id,
            project_name=project_name
        ))

    return responses


@router.patch(
    "/users/{user_id}/project",
    response_model=UserResponse,
)
async def assign_user_to_project(
    user_id: int,
    data: AssignUserToProjectRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Assign user to project (superuser only)

    Updates the user's project_id field. Set to None to unassign.

    Args:
        user_id: User ID to assign
        data: Project assignment data (project_id or None to unassign)
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Updated user with project assignment

    Raises:
        HTTPException 404: User or project not found
    """
    # Get user
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found"
        )

    # If assigning to a project, verify it exists
    project_name = None
    if data.project_id is not None:
        project_result = await db.execute(
            select(Project).where(Project.id == data.project_id)
        )
        project = project_result.scalar_one_or_none()

        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project with ID {data.project_id} not found"
            )

        project_name = project.name

    # Update user's project assignment
    user.project_id = data.project_id
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=user.is_verified,
        role=user.role,
        project_id=user.project_id,
        project_name=project_name
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
    current_user: User = Depends(current_superuser),
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
