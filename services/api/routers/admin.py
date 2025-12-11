"""
Admin endpoints for managing email allowlist.

Only accessible by superusers.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from shared.models import User, EmailAllowlist
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
