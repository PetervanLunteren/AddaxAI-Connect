"""
FastAPI-Users configuration.

Sets up authentication backend with JWT bearer tokens.
"""
from fastapi import Depends
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import User
from shared.database import get_async_session
from shared.config import get_settings
from .user_manager import get_user_manager


settings = get_settings()


# Ensure JWT secret is configured
if not settings.jwt_secret:
    raise ValueError("JWT_SECRET must be set in environment variables")


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    """
    Get user database adapter.

    Args:
        session: Database session

    Yields:
        SQLAlchemyUserDatabase instance
    """
    yield SQLAlchemyUserDatabase(session, User)


def get_jwt_strategy() -> JWTStrategy:
    """
    Get JWT authentication strategy.

    Returns:
        JWTStrategy with 1 hour expiration
    """
    return JWTStrategy(
        secret=settings.jwt_secret,
        lifetime_seconds=3600,  # 1 hour
    )


# Bearer token transport (Authorization: Bearer <token>)
bearer_transport = BearerTransport(tokenUrl="auth/login")

# Authentication backend
auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# FastAPI-Users instance
fastapi_users = FastAPIUsers[User, int](
    get_user_manager,
    [auth_backend],
)

# Dependencies for protected routes
current_active_user = fastapi_users.current_user(active=True)
current_verified_user = fastapi_users.current_user(active=True, verified=True)

# Optional authentication dependency (allows both authenticated and anonymous requests)
optional_current_user = fastapi_users.current_user(active=True, verified=True, optional=True)

# Note: current_superuser removed - use require_server_admin from permissions.py instead
# Old code used: current_superuser = fastapi_users.current_user(active=True, superuser=True)
# New code uses: from auth.permissions import require_server_admin
