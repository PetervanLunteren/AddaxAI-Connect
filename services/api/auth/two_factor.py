"""Two-factor login: the rules, without the web framework.

A user can protect the account with a six-digit code from an authenticator
app (TOTP, RFC 6238). A project can require that from everyone who can open
it. This module holds everything that decides something:

- the authenticator secret and how it is stored (encrypted)
- checking a code, and making sure a code works only once
- recovery codes, for a lost phone
- the two short-lived tokens around the login: "password was right, code
  still to come" and "this browser was remembered"
- which of the three things a login ends in

The routes are in two_factor_routes.py. The gate sits in the login flow and
not in the access token check, because change-password, the demo login and
scripts/verify-server.sh mint access tokens for accounts that are already in.

Why the secret is encrypted when the Telegram bot token is not. Whoever reads
the secret can make valid codes for ever, and the nightly database dump goes
to the backup bucket as it is. The key is derived from JWT_SECRET, which lives
in .env and not in the database. That also means a new JWT_SECRET makes every
stored secret unreadable. Recovery codes keep working then, and
scripts/reset_two_factor.py --all clears the rest.
"""
import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

import jwt
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.twofactor.totp import TOTP
from fastapi_users.jwt import decode_jwt, generate_jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.config import get_settings
from shared.logger import get_logger
from shared.models import Project, ProjectMembership, User

logger = get_logger("api.auth.two_factor")
settings = get_settings()

CODE_DIGITS = 6
TIME_STEP_SECONDS = 30
# The current step first, then one back and one ahead, for a phone clock that
# is a little off. RFC 6238 advises at most one step.
ACCEPTED_STEP_OFFSETS = (0, -1, 1)

RECOVERY_CODE_COUNT = 10
# 80 bits each. Long enough that a plain sha256 of it cannot be guessed back
# from a leaked database, so the codes do not depend on the encryption key.
RECOVERY_CODE_BYTES = 10

PENDING_AUDIENCE = "two-factor-pending"
# Long enough to install an authenticator app during a forced setup
PENDING_LIFETIME_SECONDS = 15 * 60

REMEMBER_AUDIENCE = "two-factor-remember"
REMEMBER_LIFETIME_SECONDS = 30 * 24 * 3600
REMEMBER_COOKIE = "two_factor_remember"


# --- The authenticator secret ---

def _fernet() -> Fernet:
    """The key for stored secrets, derived from JWT_SECRET.

    HKDF with its own info string, so this key is not the signing key itself
    and a token can never double as a ciphertext.
    """
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"two-factor-secret",
    ).derive(settings.jwt_secret.encode())
    return Fernet(base64.urlsafe_b64encode(key))


def new_secret() -> bytes:
    """A fresh random authenticator secret (160 bits, as RFC 4226 advises)."""
    return secrets.token_bytes(20)


def encrypt_secret(secret: bytes) -> str:
    return _fernet().encrypt(secret).decode()


def decrypt_secret(stored: str) -> Optional[bytes]:
    """The secret, or None when it cannot be read with the current key."""
    try:
        return _fernet().decrypt(stored.encode())
    except InvalidToken:
        return None


def secret_as_text(secret: bytes) -> str:
    """The secret the way a user types it into an authenticator app."""
    return base64.b32encode(secret).decode().rstrip("=")


def _totp(secret: bytes) -> TOTP:
    return TOTP(secret, CODE_DIGITS, hashes.SHA1(), TIME_STEP_SECONDS)


def provisioning_uri(secret: bytes, email: str) -> str:
    """The otpauth address behind the QR code.

    The server's domain is part of the name, so one person with accounts on
    several servers can tell the entries apart in the app.
    """
    issuer = "AddaxAI Connect"
    if settings.domain_name:
        issuer = f"{issuer} ({settings.domain_name})"
    return _totp(secret).get_provisioning_uri(email, issuer)


# --- Checking a code ---

def is_authenticator_code(text: str) -> bool:
    """Six digits is a code from the app, anything else a recovery code."""
    return len(text) == CODE_DIGITS and text.isdigit()


def accepted_step(
    secret: bytes,
    code: str,
    last_step: Optional[int],
    now: Optional[float] = None,
) -> Optional[int]:
    """The time step a code belongs to, or None when the code is not accepted.

    A code is accepted when it is right for the current step or a neighbour,
    and that step is later than the last one used. Storing the returned step
    is what makes a code work only once (RFC 6238 section 5.2).
    """
    current = int((time.time() if now is None else now) // TIME_STEP_SECONDS)
    totp = _totp(secret)
    for offset in ACCEPTED_STEP_OFFSETS:
        step = current + offset
        expected = totp.generate(step * TIME_STEP_SECONDS)
        if hmac.compare_digest(expected, code.encode()):
            if last_step is not None and step <= last_step:
                return None
            return step
    return None


def clean_code(code: str) -> str:
    """A typed code without the spaces and dashes people add, in upper case."""
    return code.replace(" ", "").replace("-", "").upper()


def new_recovery_codes() -> list[str]:
    """Ten one-time codes, shown once, as XXXX-XXXX-XXXX-XXXX."""
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = base64.b32encode(secrets.token_bytes(RECOVERY_CODE_BYTES)).decode()
        codes.append("-".join(raw[i:i + 4] for i in range(0, len(raw), 4)))
    return codes


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(clean_code(code).encode()).hexdigest()


def start_two_factor(user: User, step: int, now: datetime) -> list[str]:
    """Switch two-factor on for a user and return the fresh recovery codes.

    `step` is the time step of the code that confirmed the setup, stored so
    that same code cannot be used again at the login that follows.
    """
    codes = new_recovery_codes()
    user.two_factor_enabled_at = now
    user.totp_last_step = step
    user.recovery_code_hashes = [hash_recovery_code(code) for code in codes]
    return codes


def use_code(user: User, code: str, now: Optional[float] = None) -> bool:
    """Check a typed code against a user's two-factor login, and use it up.

    Takes a code from the app or a recovery code. On success the user row is
    changed (the step is stored, or the recovery code is removed), so the
    caller must hold the row lock and commit.
    """
    code = clean_code(code)

    if is_authenticator_code(code):
        secret = decrypt_secret(user.totp_secret) if user.totp_secret else None
        if secret is None:
            logger.error(
                "Two-factor secret cannot be read, was JWT_SECRET changed? "
                "A recovery code or scripts/reset_two_factor.py gets the user in",
                user_id=user.id,
            )
            return False
        step = accepted_step(secret, code, user.totp_last_step, now)
        if step is None:
            return False
        user.totp_last_step = step
        return True

    hashed = hash_recovery_code(code)
    unused = user.recovery_code_hashes or []
    if hashed not in unused:
        return False
    # A new list: SQLAlchemy does not see a change inside a JSON value
    user.recovery_code_hashes = [h for h in unused if h != hashed]
    return True


# --- The tokens around the login ---

def _write_token(user: User, audience: str, lifetime_seconds: int) -> str:
    data = {"sub": str(user.id), "aud": audience, "iat": datetime.now(timezone.utc)}
    return generate_jwt(data, settings.jwt_secret, lifetime_seconds)


def _read_token(token: Optional[str], audience: str) -> Optional[tuple[int, datetime]]:
    """The user id and issue time in a token, or None when it is not valid.

    The audience keeps the kinds apart: an access token is not a pending
    token, and neither is a remember token.
    """
    if not token:
        return None
    try:
        data = decode_jwt(token, settings.jwt_secret, [audience])
        return int(data["sub"]), datetime.fromtimestamp(int(data["iat"]), tz=timezone.utc)
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        return None


def _not_older_than(issued_at: datetime, *stamps: Optional[datetime]) -> bool:
    """True when a token was issued at or after every stamp that is set."""
    return all(stamp is None or issued_at >= stamp for stamp in stamps)


def write_pending_token(user: User) -> str:
    """Proof that the password was right, for the step that comes next."""
    return _write_token(user, PENDING_AUDIENCE, PENDING_LIFETIME_SECONDS)


def pending_user_id(token: Optional[str]) -> Optional[tuple[int, datetime]]:
    return _read_token(token, PENDING_AUDIENCE)


def pending_token_fits(user: User, issued_at: datetime) -> bool:
    """A pending token stops working when the account or its password changes."""
    return user.is_active and _not_older_than(issued_at, user.password_changed_at)


def write_remember_token(user: User) -> str:
    return _write_token(user, REMEMBER_AUDIENCE, REMEMBER_LIFETIME_SECONDS)


def browser_is_remembered(token: Optional[str], user: User) -> bool:
    """True when this browser passed the code step for this user before.

    The token must be younger than the last password change and than the
    moment two-factor was switched on. So a new password, switching off, a
    reset and a new setup all end every remembered browser at once.
    """
    read = _read_token(token, REMEMBER_AUDIENCE)
    if read is None or not user.two_factor_enabled:
        return False
    user_id, issued_at = read
    return user_id == user.id and _not_older_than(
        issued_at, user.password_changed_at, user.two_factor_enabled_at,
    )


# --- What a login ends in ---

TOKEN = "token"
CODE_REQUIRED = "code_required"
SETUP_REQUIRED = "setup_required"


def login_outcome(enabled: bool, required: bool, remembered: bool) -> str:
    """What happens after a correct password.

    - two-factor on: ask for a code, unless this browser is remembered
    - two-factor off but required: the user must set it up before getting in
    - otherwise: logged in
    """
    if enabled:
        return TOKEN if remembered else CODE_REQUIRED
    return SETUP_REQUIRED if required else TOKEN


async def two_factor_required(user: User, db: AsyncSession) -> bool:
    """True when the user can open a project that requires two-factor login.

    A server admin can open every project, so one requiring project is enough.
    """
    requiring = select(Project.id).where(Project.require_two_factor.is_(True))
    if not user.is_superuser:
        requiring = requiring.join(
            ProjectMembership, ProjectMembership.project_id == Project.id,
        ).where(ProjectMembership.user_id == user.id)
    return bool(await db.scalar(select(requiring.exists())))
