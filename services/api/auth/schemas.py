"""
Pydantic schemas for FastAPI-Users.

Defines request/response models for user authentication.
"""
from fastapi_users import schemas


class UserRead(schemas.BaseUser[int]):
    """
    Schema for reading user data (response).

    Note: role and project_id removed - now handled via project_memberships table.
    Use /users/me/projects endpoint to get user's project memberships.
    """
    is_server_admin: bool  # Renamed from is_superuser


class UserCreate(schemas.BaseUserCreate):
    """
    Schema for creating a new user (request).

    is_server_admin is set internally by UserManager based on email allowlist,
    not provided by the user during registration.
    """
    is_server_admin: bool = False  # Default to False, will be overridden by allowlist


class UserUpdate(schemas.BaseUserUpdate):
    """
    Schema for updating user data (request).

    Note: role and project_id removed - use project membership endpoints instead.
    """
    pass
