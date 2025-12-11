"""
Authentication routes using FastAPI-Users.

Provides endpoints for:
- Registration
- Login/logout
- Email verification
- Password reset
"""
from fastapi import APIRouter

from .users import fastapi_users, auth_backend
from .schemas import UserRead, UserCreate, UserUpdate


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

    return router
