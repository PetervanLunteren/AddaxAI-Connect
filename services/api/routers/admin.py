"""
Admin endpoints for managing email allowlist.

Only accessible by superusers.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from shared.models import User, EmailAllowlist, Project
from shared.database import get_async_session
from auth.users import current_superuser


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
