"""Throttle the login endpoint.

A password only has to be guessed once, and the login form is the one door on
this system that faces the whole internet. Without a limit an attacker can try
passwords as fast as the network allows.

Why not slowapi, which is already a dependency. Its limit() is a decorator and
has to wrap the route function, and the login route belongs to fastapi-users,
not to us. A dependency attaches from the outside without forking the library.

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

# Only this path is throttled. The auth router also carries /auth/logout, and
# a 429 on logout would be a confusing way to punish a shared office address.
LOGIN_PATH_SUFFIX = "/auth/login"

LOGIN_MAX_ATTEMPTS = 20
LOGIN_WINDOW_SECONDS = 300  # 5 minutes

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


async def login_rate_limit(request: Request) -> None:
    """Reject a login once an address has used up its attempts.

    Fails open. If Redis cannot be reached the request is allowed through and
    a warning is logged: refusing every login because the cache is unreachable
    would turn a cache problem into a total outage, and the rest of the system
    is already broken in that situation anyway.
    """
    if not request.url.path.endswith(LOGIN_PATH_SUFFIX):
        return

    ip = client_ip(request)
    key = f"ratelimit:login:{ip}"

    try:
        attempts = await _client().incr(key)
        if attempts == 1:
            await _client().expire(key, LOGIN_WINDOW_SECONDS)
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
