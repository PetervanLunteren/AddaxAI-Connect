"""
Pydantic schemas for FastAPI-Users.

Defines request/response models for user authentication.
"""
from typing import Optional
from fastapi_users import schemas


class UserRead(schemas.BaseUser[int]):
    """
    Schema for reading user data (response).

    Note: role and project_id removed - now handled via project_memberships table.
    Use /users/me/projects endpoint to get user's project memberships.
    """
    is_superuser: bool  # Server admin flag
    two_factor_enabled: bool  # Read from the User.two_factor_enabled property


class UserCreate(schemas.BaseUserCreate):
    """
    Schema for creating a new user (request).

    Requires invitation token for secure registration.
    is_superuser is set internally by UserManager based on invitation,
    not provided by the user during registration.
    """
    token: str  # Required invitation token (from email link)
    is_superuser: bool = False  # Default to False, will be overridden by invitation
