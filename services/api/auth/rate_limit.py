"""Throttle the login endpoint.

A password only has to be guessed once, and the login form is the one door on
this system that faces the whole internet. Without a limit an attacker can try
passwords as fast as the network allows.

It is a dependency on the login route (auth/routes.py), so it runs before the
password is even looked at.

Why Redis and not an in-memory counter. The API runs one uvicorn process today,
so a dict would work, but it would silently stop working the day anyone adds
--workers, and each worker would grant the full allowance. Redis is already a
hard dependency of every service.

The window is fixed, not sliding. A determined attacker can therefore send
2 x LOGIN_MAX_ATTEMPTS across a window boundary. That is a known and accepted
property: the goal is to turn millions of guesses into a few dozen, not to be
exact at the edges.
"""
from typing import Optional

import redis.asyncio as aioredis
from fastapi import HTTPException, Request, status

from shared.config import get_settings
from shared.logger import get_logger

logger = get_logger("api.auth.rate_limit")
settings = get_settings()

LOGIN_MAX_ATTEMPTS = 20
LOGIN_WINDOW_SECONDS = 300  # 5 minutes

# Wrong two-factor codes, per account. See the two functions at the bottom.
TWO_FACTOR_MAX_FAILURES = 5
TWO_FACTOR_WINDOW_SECONDS = 900  # 15 minutes

_redis: Optional[aioredis.Redis] = None


def _client() -> aioredis.Redis:
    """One connection pool for the process, created on first use."""
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def client_ip(request: Request) -> str:
    """The address the request really came from.

    Nginx sets X-Real-IP to $remote_addr and overwrites whatever the client
    sent, so it cannot be spoofed from outside. Without it every request looks
    like it comes from the nginx container, and one attacker would lock out
    every user at once.
    """
    forwarded = request.headers.get("x-real-ip")
    if forwarded:
        return forwarded.strip()
    return request.client.host if request.client else "unknown"


async def _count(key: str, window_seconds: int) -> int:
    """Add one to a counter and return it. The window starts at the first hit."""
    count = await _client().incr(key)
    if count == 1:
        await _client().expire(key, window_seconds)
    return count


async def login_rate_limit(request: Request) -> None:
    """Reject a login once an address has used up its attempts.

    Fails open. If Redis cannot be reached the request is allowed through and
    a warning is logged: refusing every login because the cache is unreachable
    would turn a cache problem into a total outage, and the rest of the system
    is already broken in that situation anyway.
    """
    ip = client_ip(request)
    key = f"ratelimit:login:{ip}"

    try:
        attempts = await _count(key, LOGIN_WINDOW_SECONDS)
    except Exception:
        logger.warning("Login rate limit unavailable, allowing the request", ip=ip)
        return

    if attempts > LOGIN_MAX_ATTEMPTS:
        try:
            retry_after = await _client().ttl(key)
        except Exception:
            retry_after = LOGIN_WINDOW_SECONDS
        retry_after = retry_after if retry_after and retry_after > 0 else LOGIN_WINDOW_SECONDS

        logger.warning("Login rate limit hit", ip=ip, attempts=attempts)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-in attempts. Please wait and try again.",
            headers={"Retry-After": str(retry_after)},
        )


# --- Wrong two-factor codes ---
#
# A six-digit code has a million values and three of them are right at any
# moment. Whoever gets this far already has the password, so this counter is
# the only thing between them and the account. Two differences with the login
# throttle above follow from that:
#
# - It counts per account and not per address. Spreading the guesses over many
#   addresses must not help.
# - It fails closed. When Redis cannot be reached no code is accepted, where
#   the login throttle lets the request through.
#
# Only wrong codes are counted, so a user who types the code right is never
# slowed down. The account id comes from a checked token, never from the
# request body, or anyone could lock anyone else out.

def _two_factor_key(user_id: int) -> str:
    return f"ratelimit:two-factor:{user_id}"


async def two_factor_attempt_allowed(user_id: int) -> None:
    """Refuse a code check once an account has had too many wrong codes."""
    try:
        failures = int(await _client().get(_two_factor_key(user_id)) or 0)
    except Exception:
        logger.error("Two-factor attempt limit unavailable, refusing the code", user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TWO_FACTOR_UNAVAILABLE",
        )

    if failures >= TWO_FACTOR_MAX_FAILURES:
        logger.warning("Two-factor attempt limit hit", user_id=user_id, failures=failures)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="TWO_FACTOR_TOO_MANY_ATTEMPTS",
        )


async def count_two_factor_failure(user_id: int) -> None:
    """Note a wrong code. A failure to count is a failure to check, so it raises."""
    try:
        await _count(_two_factor_key(user_id), TWO_FACTOR_WINDOW_SECONDS)
    except Exception:
        logger.error("Two-factor attempt limit unavailable, refusing the code", user_id=user_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TWO_FACTOR_UNAVAILABLE",
        )
