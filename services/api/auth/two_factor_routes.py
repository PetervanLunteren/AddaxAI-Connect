"""Routes for two-factor login. The rules are in two_factor.py.

    POST /auth/login/two-factor     the code step after the password
    POST /auth/two-factor/setup     start a setup, returns the key for the app
    POST /auth/two-factor/enable    confirm the setup with a first code
    POST /auth/two-factor/disable   switch it off, with a code

Setup and enable are reached two ways. A logged-in user opens them from the
user menu. A user who must set it up at login (a project requires it) has no
login yet and sends the pending token from POST /auth/login in the body.

No route here answers 401 for a pending token that ran out, because the
frontend sends every 401 to the login page and the user is already there.
Those are 400 with a code in `detail`, like LOGIN_BAD_CREDENTIALS.

Every route that checks a code locks the user row first. The API runs more
than one worker, and without the lock the same code could pass twice.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mailer.sender import get_email_sender
from shared.config import get_settings
from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import User

from . import two_factor
from .rate_limit import count_two_factor_failure, two_factor_attempt_allowed
from .stamps import now_stamp
from .users import DEMO_USER_EMAIL, current_active_user, fastapi_users, get_jwt_strategy

logger = get_logger("api.auth.two_factor")
settings = get_settings()

router = APIRouter(prefix="/auth", tags=["auth"])

# A session is optional here: setup and enable also take a pending token
optional_active_user = fastapi_users.current_user(active=True, optional=True)


class PendingRequest(BaseModel):
    pending_token: Optional[str] = None


class CodeRequest(BaseModel):
    code: str


class EnableRequest(CodeRequest, PendingRequest):
    pass


class LoginCodeRequest(CodeRequest):
    pending_token: str
    remember: bool = False


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


async def _lock_user(db: AsyncSession, user_id: int) -> Optional[User]:
    """Load a user and hold the row until the request commits."""
    result = await db.execute(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _pending_user(db: AsyncSession, pending_token: str) -> User:
    """The locked user a pending token is for, or a 400 when it ran out."""
    read = two_factor.pending_user_id(pending_token)
    user = await _lock_user(db, read[0]) if read else None
    if user is None or not two_factor.pending_token_fits(user, read[1]):
        raise _bad_request("TWO_FACTOR_PENDING_EXPIRED")
    return user


async def _setup_user(
    db: AsyncSession, pending_token: Optional[str], session_user: Optional[User],
) -> tuple[User, bool]:
    """The locked user who is setting up, and whether they came by pending token."""
    if pending_token:
        return await _pending_user(db, pending_token), True
    if session_user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return await _lock_user(db, session_user.id), False


async def _check_code(user: User, code: str) -> None:
    """Use up a code for a user with two-factor on, or raise."""
    await two_factor_attempt_allowed(user.id)
    if not two_factor.use_code(user, code):
        await count_two_factor_failure(user.id)
        raise _bad_request("TWO_FACTOR_BAD_CODE")


async def send_notice(email: str, event: str) -> None:
    """Tell a user their two-factor login changed. A mail problem is logged
    and does not undo the change, which is already committed."""
    try:
        await get_email_sender().send_two_factor_notice_email(email, event)
    except Exception as e:
        logger.error(
            "Failed to send two-factor notice",
            email=email, two_factor_event=event, error=str(e), exc_info=True,
        )


async def _access_token(user: User) -> dict:
    token = await get_jwt_strategy().write_token(user)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/login/two-factor")
async def login_with_code(
    body: LoginCodeRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
):
    """The second step of a login: a code from the app, or a recovery code."""
    user = await _pending_user(db, body.pending_token)
    if not user.two_factor_enabled:
        raise _bad_request("TWO_FACTOR_NOT_ON")

    await _check_code(user, body.code)
    await db.commit()
    logger.info("Logged in with two-factor code", user_id=user.id, remember=body.remember)

    if body.remember:
        response.set_cookie(
            two_factor.REMEMBER_COOKIE,
            two_factor.write_remember_token(user),
            max_age=two_factor.REMEMBER_LIFETIME_SECONDS,
            path="/auth",
            httponly=True,
            samesite="strict",
            # Nginx sets this header itself. request.url.scheme is always
            # http here, uvicorn runs behind nginx without proxy headers.
            secure=request.headers.get("x-forwarded-proto") == "https",
        )
    return await _access_token(user)


@router.post("/two-factor/setup")
async def setup(
    body: PendingRequest,
    db: AsyncSession = Depends(get_async_session),
    session_user: Optional[User] = Depends(optional_active_user),
):
    """Start a setup: make a secret and return it for the authenticator app.

    Refused when two-factor is already on. Otherwise someone with only the
    password could put their own phone on the account.
    """
    user, _ = await _setup_user(db, body.pending_token, session_user)
    if user.two_factor_enabled:
        raise _bad_request("TWO_FACTOR_ALREADY_ON")
    if settings.demo_mode and user.email == DEMO_USER_EMAIL:
        # One visitor would lock the shared demo account for everyone
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="TWO_FACTOR_NOT_FOR_DEMO")

    secret = two_factor.new_secret()
    user.totp_secret = two_factor.encrypt_secret(secret)
    await db.commit()

    return {
        "key": two_factor.secret_as_text(secret),
        "otpauth_uri": two_factor.provisioning_uri(secret, user.email),
    }


@router.post("/two-factor/enable")
async def enable(
    body: EnableRequest,
    db: AsyncSession = Depends(get_async_session),
    session_user: Optional[User] = Depends(optional_active_user),
):
    """Confirm a setup with a first code from the app and switch two-factor on.

    Returns the recovery codes, this once. A user who came by pending token
    is logged in by this step and gets the access token as well.
    """
    user, by_pending_token = await _setup_user(db, body.pending_token, session_user)
    if user.two_factor_enabled:
        raise _bad_request("TWO_FACTOR_ALREADY_ON")
    secret = two_factor.decrypt_secret(user.totp_secret) if user.totp_secret else None
    if secret is None:
        raise _bad_request("TWO_FACTOR_NO_SETUP")

    await two_factor_attempt_allowed(user.id)
    step = two_factor.accepted_step(secret, two_factor.clean_code(body.code), None)
    if step is None:
        await count_two_factor_failure(user.id)
        raise _bad_request("TWO_FACTOR_BAD_CODE")

    recovery_codes = two_factor.start_two_factor(user, step, now_stamp())
    await db.commit()
    logger.info("Two-factor login switched on", user_id=user.id)
    await send_notice(user.email, "enabled")

    result: dict = {"recovery_codes": recovery_codes}
    if by_pending_token:
        result.update(await _access_token(user))
    return result


@router.post("/two-factor/disable")
async def disable(
    body: CodeRequest,
    db: AsyncSession = Depends(get_async_session),
    session_user: User = Depends(current_active_user),
):
    """Switch two-factor off. Needs a code, a login alone is not enough."""
    user = await _lock_user(db, session_user.id)
    if not user.two_factor_enabled:
        raise _bad_request("TWO_FACTOR_NOT_ON")
    if await two_factor.two_factor_required(user, db):
        raise _bad_request("TWO_FACTOR_REQUIRED")

    await _check_code(user, body.code)
    user.clear_two_factor()
    await db.commit()
    logger.info("Two-factor login switched off", user_id=user.id)
    await send_notice(user.email, "disabled")
    return {"message": "Two-factor login is off"}
