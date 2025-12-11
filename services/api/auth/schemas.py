"""
Pydantic schemas for FastAPI-Users.

Defines request/response models for user authentication.
"""
from typing import Optional
from fastapi_users import schemas


class UserRead(schemas.BaseUser[int]):
    """Schema for reading user data (response)"""
    role: Optional[str] = None
    project_id: Optional[int] = None


class UserCreate(schemas.BaseUserCreate):
    """Schema for creating a new user (request)"""
    pass


class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating user data (request)"""
    role: Optional[str] = None
    project_id: Optional[int] = None
