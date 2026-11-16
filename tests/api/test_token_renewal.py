"""
Access tokens renew while the app is open, for at most MAX_SESSION.

Uses the real strategy from auth/users.py. The user manager is a stub, so no
database is needed.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")))

from fastapi_users.jwt import decode_jwt, generate_jwt  # noqa: E402

from auth.users import MAX_SESSION, get_jwt_strategy, may_renew  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _user(password_changed_at=None):
    return SimpleNamespace(id=7, is_active=True, password_changed_at=password_changed_at)


class _UserManager:
    """Just enough of BaseUserManager for JWTStrategy.read_token."""

    def __init__(self, user):
        self.user = user

    def parse_id(self, value):
        return int(value)

    async def get(self, user_id):
        return self.user


def _claims(token):
    strategy = get_jwt_strategy()
    return decode_jwt(token, strategy.decode_key, strategy.token_audience, algorithms=[strategy.algorithm])


class TestAuthTime:
    def test_new_login_stamps_auth_time(self):
        token = _run(get_jwt_strategy().write_token(_user()))
        claims = _claims(token)
        assert abs(claims["auth_time"] - claims["iat"]) <= 1

    def test_renewed_token_keeps_the_login_time(self):
        login = int(datetime(2026, 11, 16, 8, 0, tzinfo=timezone.utc).timestamp())
        token = _run(get_jwt_strategy().write_token(_user(), auth_time=login))
        assert get_jwt_strategy().session_start(token) == login

    def test_token_from_before_renewal_uses_iat(self):
        strategy = get_jwt_strategy()
        iat = datetime(2026, 11, 16, 8, 0, tzinfo=timezone.utc)
        old = generate_jwt(
            {"sub": "7", "aud": strategy.token_audience, "iat": iat},
            strategy.encode_key, 3600, algorithm=strategy.algorithm,
        )
        assert strategy.session_start(old) == int(iat.timestamp())

    def test_garbage_has_no_start(self):
        assert get_jwt_strategy().session_start("not-a-token") is None


class TestMayRenew:
    LOGIN = datetime(2026, 11, 16, 8, 0, tzinfo=timezone.utc)

    def test_within_the_day(self):
        assert may_renew(int(self.LOGIN.timestamp()), self.LOGIN + timedelta(hours=23, minutes=59))

    def test_not_after_the_day(self):
        assert not may_renew(int(self.LOGIN.timestamp()), self.LOGIN + MAX_SESSION)

    def test_maximum_is_a_day(self):
        # Covers an overnight bulk upload on a slow link (spw, about 8 s per file).
        assert MAX_SESSION == timedelta(hours=24)


class TestPasswordChangeStillEndsSessions:
    def test_token_from_before_a_password_change_cannot_renew(self):
        # /auth/refresh needs current_active_user, which runs read_token.
        strategy = get_jwt_strategy()
        token = _run(strategy.write_token(_user()))
        changed_later = datetime.now(timezone.utc) + timedelta(seconds=5)
        assert _run(strategy.read_token(token, _UserManager(_user(changed_later)))) is None

    def test_token_after_the_change_is_accepted(self):
        strategy = get_jwt_strategy()
        changed_before = datetime.now(timezone.utc) - timedelta(minutes=5)
        token = _run(strategy.write_token(_user()))
        assert _run(strategy.read_token(token, _UserManager(_user(changed_before)))) is not None
