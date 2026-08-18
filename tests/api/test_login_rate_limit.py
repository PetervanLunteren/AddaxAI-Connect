"""Tests for the login throttle.

The two things worth pinning down are the ones that would be silently wrong:
which address the limit counts against, and that a Redis problem does not lock
everybody out of the system.
"""
import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")))

import pytest
from fastapi import HTTPException

from auth import rate_limit
from auth.rate_limit import LOGIN_MAX_ATTEMPTS, client_ip, login_rate_limit


class FakeRequest:
    def __init__(self, path="/auth/login", headers=None, client_host="10.0.0.1"):
        self.url = type("U", (), {"path": path})()
        self.headers = headers or {}
        self.client = type("C", (), {"host": client_host})() if client_host else None


class FakeRedis:
    """Counts like Redis does, and can be told to break."""

    def __init__(self, broken=False):
        self.counts = {}
        self.expires = {}
        self.broken = broken

    async def incr(self, key):
        if self.broken:
            raise ConnectionError("redis is down")
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        if self.broken:
            raise ConnectionError("redis is down")
        self.expires[key] = seconds

    async def ttl(self, key):
        if self.broken:
            raise ConnectionError("redis is down")
        return self.expires.get(key, -1)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(rate_limit, "_client", lambda: fake)
    return fake


class TestClientIp:
    def test_prefers_the_header_nginx_sets(self):
        # Without this every request looks like it comes from the nginx
        # container and one attacker would lock out every user at once.
        req = FakeRequest(headers={"x-real-ip": "203.0.113.9"}, client_host="172.18.0.5")
        assert client_ip(req) == "203.0.113.9"

    def test_falls_back_to_the_socket_address(self):
        assert client_ip(FakeRequest(client_host="203.0.113.9")) == "203.0.113.9"

    def test_survives_a_request_with_no_client(self):
        assert client_ip(FakeRequest(client_host=None)) == "unknown"


class TestLoginRateLimit:
    @pytest.mark.asyncio
    async def test_allows_up_to_the_limit(self, fake_redis):
        req = FakeRequest(headers={"x-real-ip": "203.0.113.9"})
        for _ in range(LOGIN_MAX_ATTEMPTS):
            await login_rate_limit(req)

    @pytest.mark.asyncio
    async def test_rejects_once_over_the_limit(self, fake_redis):
        req = FakeRequest(headers={"x-real-ip": "203.0.113.9"})
        for _ in range(LOGIN_MAX_ATTEMPTS):
            await login_rate_limit(req)
        with pytest.raises(HTTPException) as excinfo:
            await login_rate_limit(req)
        assert excinfo.value.status_code == 429
        assert "Retry-After" in excinfo.value.headers

    @pytest.mark.asyncio
    async def test_one_address_does_not_spend_another_address_allowance(self, fake_redis):
        attacker = FakeRequest(headers={"x-real-ip": "203.0.113.9"})
        innocent = FakeRequest(headers={"x-real-ip": "198.51.100.4"})
        for _ in range(LOGIN_MAX_ATTEMPTS + 1):
            try:
                await login_rate_limit(attacker)
            except HTTPException:
                pass
        await login_rate_limit(innocent)  # must not raise

    @pytest.mark.asyncio
    async def test_logout_is_not_throttled(self, fake_redis):
        req = FakeRequest(path="/auth/logout", headers={"x-real-ip": "203.0.113.9"})
        for _ in range(LOGIN_MAX_ATTEMPTS * 3):
            await login_rate_limit(req)
        assert fake_redis.counts == {}

    @pytest.mark.asyncio
    async def test_fails_open_when_redis_is_down(self, monkeypatch):
        # A cache problem must not become a total sign-in outage.
        monkeypatch.setattr(rate_limit, "_client", lambda: FakeRedis(broken=True))
        req = FakeRequest(headers={"x-real-ip": "203.0.113.9"})
        for _ in range(LOGIN_MAX_ATTEMPTS * 2):
            await login_rate_limit(req)  # must not raise

    @pytest.mark.asyncio
    async def test_window_is_set_once_not_refreshed_every_attempt(self, fake_redis):
        # Refreshing the expiry on every attempt would let a steady trickle of
        # guesses keep the window open forever without ever resetting.
        req = FakeRequest(headers={"x-real-ip": "203.0.113.9"})
        await login_rate_limit(req)
        await login_rate_limit(req)
        assert len(fake_redis.expires) == 1
