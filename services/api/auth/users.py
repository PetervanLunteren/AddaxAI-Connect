"""
FastAPI-Users configuration.

Sets up authentication backend with JWT bearer tokens.
"""
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import Depends
from fastapi_users import FastAPIUsers, exceptions, models
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.jwt import decode_jwt, generate_jwt
from fastapi_users.manager import BaseUserManager
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


class PasswordChangeAwareJWTStrategy(JWTStrategy[models.UP, models.ID]):
    """
    JWTStrategy that includes an `iat` (issued-at) claim and rejects any
    token issued strictly before the user's `password_changed_at`. Other
    sessions are invalidated automatically the moment a user changes
    their password.

    The default fastapi-users JWTStrategy does not stamp `iat`, so we
    override `write_token` to add it. `read_token` re-decodes the token
    to read the `iat` and compares against `user.password_changed_at`.

    Tokens minted by the previous strategy (no `iat` claim) are accepted
    until they expire naturally, so the migration is graceful.
    """

    async def write_token(self, user) -> str:
        data = {
            "sub": str(user.id),
            "aud": self.token_audience,
            "iat": datetime.now(timezone.utc),
        }
        return generate_jwt(
            data, self.encode_key, self.lifetime_seconds, algorithm=self.algorithm,
        )

    async def read_token(
        self,
        token: Optional[str],
        user_manager: BaseUserManager[models.UP, models.ID],
    ):
        user = await super().read_token(token, user_manager)
        if user is None or token is None:
            return user

        try:
            data = decode_jwt(
                token, self.decode_key, self.token_audience, algorithms=[self.algorithm],
            )
        except jwt.PyJWTError:
            return None

        iat_raw = data.get("iat")
        if iat_raw is None:
            # Pre-rollout token without iat. The 1 h expiration handles
            # the worst case so we let it through rather than logging
            # everyone out at deploy time.
            return user

        try:
            iat_dt = datetime.fromtimestamp(int(iat_raw), tz=timezone.utc)
        except (TypeError, ValueError):
            return None

        password_changed_at = getattr(user, "password_changed_at", None)
        if password_changed_at is not None and iat_dt < password_changed_at:
            return None
        return user


def get_jwt_strategy() -> PasswordChangeAwareJWTStrategy:
    """
    Get JWT authentication strategy.

    Returns:
        PasswordChangeAwareJWTStrategy with 1 hour expiration. The strategy
        rejects tokens issued before the user's last password change.
    """
    return PasswordChangeAwareJWTStrategy(
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
