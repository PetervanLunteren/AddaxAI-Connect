"""
Admin endpoints for managing email allowlist and Signal configuration.

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

from shared.models import User, EmailAllowlist, Project, SignalConfig
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


# Signal Configuration Endpoints

class SignalConfigResponse(BaseModel):
    """Response for Signal configuration"""
    phone_number: Optional[str]
    device_name: str
    is_registered: bool
    last_health_check: Optional[datetime]
    health_status: Optional[str]

    class Config:
        from_attributes = True


class SignalRegisterRequest(BaseModel):
    """Request to register Signal phone number"""
    phone_number: str  # E.164 format (e.g., +12345678900)
    device_name: Optional[str] = "AddaxAI-Connect"


class SignalUpdateConfigRequest(BaseModel):
    """Request to update Signal configuration"""
    device_name: Optional[str] = None


class SignalSubmitCaptchaRequest(BaseModel):
    """Request to submit CAPTCHA token"""
    captcha: str  # The signalcaptcha:// token


class SignalVerifyCodeRequest(BaseModel):
    """Request to submit SMS verification code"""
    code: str  # 6-digit SMS code


@router.get(
    "/signal/config",
    response_model=SignalConfigResponse,
)
async def get_signal_config(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Get current Signal configuration (superuser only).

    Returns the Signal configuration including registration status
    and health check information.

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Signal configuration

    Raises:
        HTTPException 404: If Signal config not initialized
    """
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal configuration not initialized. Use POST /api/admin/signal/register to set up Signal."
        )

    return config


@router.post(
    "/signal/register",
    response_model=SignalConfigResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_signal(
    data: SignalRegisterRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Register Signal phone number (superuser only).

    Initiates Signal registration process. The phone number will receive
    an SMS verification code that must be submitted via the Signal API.

    Note: This endpoint only saves the configuration. The actual Signal
    registration (SMS verification) must be completed via the signal-cli-rest-api
    web interface or API.

    Args:
        data: Phone number and device name
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Created Signal configuration

    Raises:
        HTTPException 409: If Signal already registered
    """
    # Check if config already exists
    result = await db.execute(select(SignalConfig))
    existing = result.scalar_one_or_none()

    if existing and existing.is_registered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Signal is already registered. Use DELETE to unregister first."
        )

    # Create or update config
    if existing:
        existing.phone_number = data.phone_number
        existing.device_name = data.device_name
        existing.is_registered = False
        config = existing
    else:
        config = SignalConfig(
            phone_number=data.phone_number,
            device_name=data.device_name,
            is_registered=False,
        )
        db.add(config)

    await db.commit()
    await db.refresh(config)

    return config


@router.put(
    "/signal/config",
    response_model=SignalConfigResponse,
)
async def update_signal_config(
    data: SignalUpdateConfigRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Update Signal configuration (superuser only).

    Updates Signal device name or other configuration options.

    Args:
        data: Configuration updates
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Updated Signal configuration

    Raises:
        HTTPException 404: If Signal not configured
    """
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured. Use POST /api/admin/signal/register first."
        )

    # Update fields
    if data.device_name is not None:
        config.device_name = data.device_name

    await db.commit()
    await db.refresh(config)

    return config


@router.delete(
    "/signal/config",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def unregister_signal(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Unregister Signal (superuser only).

    Removes Signal configuration. This does NOT unregister the phone number
    from Signal - you must do that via the signal-cli-rest-api interface.

    Args:
        db: Database session
        current_user: Current authenticated superuser

    Raises:
        HTTPException 404: If Signal not configured
    """
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured"
        )

    await db.delete(config)
    await db.commit()


@router.post(
    "/signal/submit-captcha",
    response_model=SignalConfigResponse,
)
async def submit_signal_captcha(
    data: SignalSubmitCaptchaRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Submit CAPTCHA token to signal-cli-rest-api (superuser only).

    After initiating registration, solve the CAPTCHA at signalcaptchas.org
    and submit the token here. This will trigger Signal to send an SMS
    verification code to the registered phone number.

    Args:
        data: CAPTCHA token from signalcaptchas.org
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Updated Signal configuration

    Raises:
        HTTPException 404: If Signal not configured
        HTTPException 400: If CAPTCHA submission fails
    """
    # Get Signal config
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured. Use POST /api/admin/signal/register first."
        )

    if config.is_registered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signal is already registered"
        )

    # Submit CAPTCHA to signal-cli-rest-api
    signal_api_url = settings.signal_api_url or "http://signal-api:8080"
    register_url = f"{signal_api_url}/v1/register/{config.phone_number}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                register_url,
                json={
                    "use_voice": False,
                    "captcha": data.captcha
                }
            )

            if response.status_code != 201:
                error_text = response.text
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to submit CAPTCHA: {error_text}"
                )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to signal-cli-rest-api: {str(e)}"
        )

    # Update config to reflect pending verification
    await db.commit()
    await db.refresh(config)

    return config


async def update_signal_profile_internal(phone_number: str):
    """
    Internal function to update Signal profile with hardcoded name and avatar.

    This sets the profile name to "AddaxAI-Connect" and uploads the avatar
    from the static folder.

    Args:
        phone_number: Phone number to update profile for

    Raises:
        Exception: If profile update fails
    """
    signal_api_url = settings.signal_api_url or "http://signal-api:8080"
    profile_url = f"{signal_api_url}/v1/profiles/{phone_number}"

    # Read and encode avatar as base64
    avatar_path = Path("/app/static/signal-avatar.png")
    base64_avatar = None

    if avatar_path.exists():
        with open(avatar_path, "rb") as avatar_file:
            avatar_bytes = avatar_file.read()
            base64_avatar = base64.b64encode(avatar_bytes).decode("utf-8")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Update profile name and avatar
        response = await client.put(
            profile_url,
            json={
                "name": "AddaxAI-Connect",
                "base64_avatar": base64_avatar
            }
        )

        if response.status_code not in [200, 201, 204]:
            raise Exception(f"Failed to update profile: {response.text}")


@router.post(
    "/signal/verify-code",
    response_model=SignalConfigResponse,
)
async def verify_signal_code(
    data: SignalVerifyCodeRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Submit SMS verification code to complete Signal registration (superuser only).

    After receiving the SMS code, submit it here to complete registration.

    Args:
        data: 6-digit SMS verification code
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Updated Signal configuration

    Raises:
        HTTPException 404: If Signal not configured
        HTTPException 400: If verification fails
    """
    # Get Signal config
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured. Use POST /api/admin/signal/register first."
        )

    if config.is_registered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signal is already registered"
        )

    # Submit verification code to signal-cli-rest-api
    signal_api_url = settings.signal_api_url or "http://signal-api:8080"
    # Verification code must be part of the URL path, not JSON body
    verify_url = f"{signal_api_url}/v1/register/{config.phone_number}/verify/{data.code}"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                verify_url,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code != 201:
                error_text = response.text
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to verify code: {error_text}"
                )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to signal-cli-rest-api: {str(e)}"
        )

    # Mark as registered
    config.is_registered = True
    await db.commit()
    await db.refresh(config)

    # Auto-update profile with hardcoded name and avatar
    try:
        await update_signal_profile_internal(config.phone_number)
    except Exception as e:
        # Log but don't fail registration if profile update fails
        print(f"Warning: Failed to update Signal profile: {str(e)}")

    return config


class SignalSendTestMessageRequest(BaseModel):
    """Request to send test Signal message"""
    recipient: str  # Phone number in E.164 format
    message: str  # Test message text


class SignalSubmitRateLimitChallengeRequest(BaseModel):
    """Request to submit rate limit challenge CAPTCHA"""
    challenge_token: str  # Challenge token from error message
    captcha: str  # CAPTCHA token from signalcaptchas.org


@router.post(
    "/signal/send-test",
    status_code=status.HTTP_200_OK,
)
async def send_test_signal_message(
    data: SignalSendTestMessageRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Send a test Signal message (superuser only).

    Sends a test message to verify Signal is working correctly.

    Args:
        data: Recipient phone number and message text
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Success message

    Raises:
        HTTPException 404: If Signal not configured or not registered
        HTTPException 400: If message sending fails
    """
    # Get Signal config
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured. Use POST /api/admin/signal/register first."
        )

    if not config.is_registered:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Signal is not registered. Complete registration first."
        )

    # Send test message via signal-cli-rest-api
    signal_api_url = settings.signal_api_url or "http://signal-api:8080"
    send_url = f"{signal_api_url}/v2/send"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                send_url,
                json={
                    "message": data.message,
                    "number": config.phone_number,
                    "recipients": [data.recipient]
                }
            )

            if response.status_code not in [200, 201]:
                error_text = response.text
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to send message: {error_text}"
                )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to signal-cli-rest-api: {str(e)}"
        )

    return {"message": "Test message sent successfully"}


@router.post(
    "/signal/submit-rate-limit-challenge",
    status_code=status.HTTP_200_OK,
)
async def submit_rate_limit_challenge(
    data: SignalSubmitRateLimitChallengeRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Submit rate limit challenge CAPTCHA (superuser only).

    When Signal rate limits a newly registered number, you need to solve
    a CAPTCHA challenge to prove you're not a bot.

    Args:
        data: Challenge token and CAPTCHA token
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Success message

    Raises:
        HTTPException 404: If Signal not configured
        HTTPException 400: If challenge submission fails
    """
    # Get Signal config
    result = await db.execute(select(SignalConfig))
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Signal not configured."
        )

    # Submit rate limit challenge to signal-cli-rest-api
    signal_api_url = settings.signal_api_url or "http://signal-api:8080"
    challenge_url = f"{signal_api_url}/v1/accounts/{config.phone_number}/rate-limit-challenge"

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                challenge_url,
                json={
                    "challenge_token": data.challenge_token,
                    "captcha": data.captcha
                }
            )

            if response.status_code not in [200, 201, 204]:
                error_text = response.text
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to submit rate limit challenge: {error_text}"
                )

    except httpx.RequestError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Could not connect to signal-cli-rest-api: {str(e)}"
        )

    return {"message": "Rate limit challenge submitted successfully. You can now send messages."}
