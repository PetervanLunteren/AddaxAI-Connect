"""
Tests for two-factor login.

The first half tests the rules in auth/two_factor.py, which need no database.
The second half calls the route functions directly, with a fake database
session and a fake Redis, to check the things that would be silently wrong:
a code that works twice, a pending token that outlives a password change,
a setup that lands on an account that already has two-factor.

No database and no HTTP, like the rest of tests/api.
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")))

import pytest  # noqa: E402
from fastapi import HTTPException, Response  # noqa: E402
from fastapi_users.jwt import generate_jwt  # noqa: E402

from auth import rate_limit, two_factor, two_factor_routes  # noqa: E402
from auth.rate_limit import (  # noqa: E402
    TWO_FACTOR_MAX_FAILURES,
    count_two_factor_failure,
    two_factor_attempt_allowed,
)
from auth.schemas import UserRead  # noqa: E402
from auth.stamps import now_stamp  # noqa: E402
from auth.two_factor import (  # noqa: E402
    CODE_REQUIRED,
    SETUP_REQUIRED,
    TIME_STEP_SECONDS,
    TOKEN,
    accepted_step,
    browser_is_remembered,
    decrypt_secret,
    encrypt_secret,
    hash_recovery_code,
    login_outcome,
    new_recovery_codes,
    new_secret,
    pending_token_fits,
    pending_user_id,
    provisioning_uri,
    secret_as_text,
    start_two_factor,
    use_code,
    write_pending_token,
    write_remember_token,
)
from auth.users import DEMO_USER_EMAIL, get_jwt_strategy  # noqa: E402
from shared.models import User  # noqa: E402

NOW = 1_800_000_000.0  # A fixed moment, so codes do not depend on the clock


def code_at(secret: bytes, moment: float) -> str:
    return two_factor._totp(secret).generate(moment).decode()


def make_user(two_factor_on: bool = False, **fields) -> tuple[User, bytes]:
    """A user, and the authenticator secret when two-factor is on."""
    user = User(id=7, email="ranger@example.org", is_active=True, is_superuser=False)
    secret = new_secret()
    if two_factor_on:
        user.totp_secret = encrypt_secret(secret)
        user.two_factor_enabled_at = now_stamp() - timedelta(days=1)
        user.recovery_code_hashes = []
    for name, value in fields.items():
        setattr(user, name, value)
    return user, secret


# --- The secret ---

class TestSecret:
    def test_encryption_round_trip(self):
        secret = new_secret()
        stored = encrypt_secret(secret)
        assert secret not in stored.encode()
        assert decrypt_secret(stored) == secret

    def test_other_key_cannot_read_it(self, monkeypatch):
        # What happens after JWT_SECRET is changed: unreadable, not a crash.
        stored = encrypt_secret(new_secret())
        monkeypatch.setattr(two_factor.settings, "jwt_secret", "another-secret")
        assert decrypt_secret(stored) is None

    def test_key_is_not_the_jwt_secret_itself(self):
        # A login token signed with JWT_SECRET must never decrypt as a secret.
        token = generate_jwt({"sub": "1", "aud": "x"}, two_factor.settings.jwt_secret, 60)
        assert decrypt_secret(token) is None

    def test_text_form_is_what_an_app_accepts(self):
        text = secret_as_text(new_secret())
        assert len(text) == 32 and "=" not in text

    def test_qr_address_names_the_account(self):
        uri = provisioning_uri(new_secret(), "ranger@example.org")
        assert uri.startswith("otpauth://totp/")
        assert "ranger%40example.org" in uri


# --- Codes from the app ---

class TestAcceptedStep:
    def test_current_code(self):
        secret = new_secret()
        assert accepted_step(secret, code_at(secret, NOW), None, NOW) == NOW // TIME_STEP_SECONDS

    def test_one_step_back_and_ahead(self):
        secret = new_secret()
        assert accepted_step(secret, code_at(secret, NOW - TIME_STEP_SECONDS), None, NOW) is not None
        assert accepted_step(secret, code_at(secret, NOW + TIME_STEP_SECONDS), None, NOW) is not None

    def test_two_steps_back_is_too_old(self):
        secret = new_secret()
        old = code_at(secret, NOW - 2 * TIME_STEP_SECONDS)
        # A code can repeat by chance, so compare with the accepted ones.
        accepted = {code_at(secret, NOW + o * TIME_STEP_SECONDS) for o in (-1, 0, 1)}
        if old not in accepted:
            assert accepted_step(secret, old, None, NOW) is None

    def test_wrong_code(self):
        secret = new_secret()
        right = {code_at(secret, NOW + o * TIME_STEP_SECONDS) for o in (-1, 0, 1)}
        wrong = next(c for c in ("000000", "111111", "222222", "333333") if c not in right)
        assert accepted_step(secret, wrong, None, NOW) is None

    def test_code_of_another_secret(self):
        secret, other = new_secret(), new_secret()
        code = code_at(other, NOW)
        if code != code_at(secret, NOW):
            assert accepted_step(secret, code, None, NOW) is None

    def test_same_code_twice_is_refused(self):
        secret = new_secret()
        code = code_at(secret, NOW)
        step = accepted_step(secret, code, None, NOW)
        assert accepted_step(secret, code, step, NOW) is None

    def test_older_step_after_a_newer_one_is_refused(self):
        # The previous code is still inside the window, but a later one was
        # used already.
        secret = new_secret()
        step = accepted_step(secret, code_at(secret, NOW), None, NOW)
        assert accepted_step(secret, code_at(secret, NOW - TIME_STEP_SECONDS), step, NOW) is None

    def test_next_code_after_a_used_one_is_accepted(self):
        secret = new_secret()
        step = accepted_step(secret, code_at(secret, NOW), None, NOW)
        later = NOW + TIME_STEP_SECONDS
        assert accepted_step(secret, code_at(secret, later), step, later) == step + 1

    def test_not_ascii_does_not_crash(self):
        assert accepted_step(new_secret(), "１２３４５６", None, NOW) is None


# --- Recovery codes and use_code ---

class TestRecoveryCodes:
    def test_ten_different_codes_in_groups_of_four(self):
        codes = new_recovery_codes()
        assert len(set(codes)) == 10
        assert all(len(code) == 19 and code.count("-") == 3 for code in codes)

    def test_typing_style_does_not_matter(self):
        code = new_recovery_codes()[0]
        assert hash_recovery_code(code) == hash_recovery_code(code.lower().replace("-", " "))

    def test_start_stores_hashes_not_codes(self):
        user, _ = make_user()
        codes = start_two_factor(user, 123, now_stamp())
        assert user.two_factor_enabled
        assert user.totp_last_step == 123
        assert sorted(user.recovery_code_hashes) == sorted(hash_recovery_code(c) for c in codes)
        assert not set(codes) & set(user.recovery_code_hashes)


class TestUseCode:
    def test_app_code_is_used_up(self):
        user, secret = make_user(two_factor_on=True)
        code = code_at(secret, NOW)
        assert use_code(user, code, NOW) is True
        assert use_code(user, code, NOW) is False

    def test_app_code_with_a_space(self):
        user, secret = make_user(two_factor_on=True)
        code = code_at(secret, NOW)
        assert use_code(user, f"{code[:3]} {code[3:]}", NOW) is True

    def test_recovery_code_works_once(self):
        user, _ = make_user()
        codes = start_two_factor(user, 0, now_stamp())
        assert use_code(user, codes[3].lower()) is True
        assert len(user.recovery_code_hashes) == 9
        assert use_code(user, codes[3]) is False
        assert use_code(user, codes[4]) is True

    def test_recovery_list_is_replaced_not_changed_in_place(self):
        # SQLAlchemy does not notice a change inside a JSON value, so a used
        # code would stay valid in the database.
        user, _ = make_user()
        codes = start_two_factor(user, 0, now_stamp())
        before = user.recovery_code_hashes
        use_code(user, codes[0])
        assert user.recovery_code_hashes is not before
        assert len(before) == 10

    def test_unknown_recovery_code(self):
        user, _ = make_user()
        start_two_factor(user, 0, now_stamp())
        assert use_code(user, "AAAA-AAAA-AAAA-AAAA") is False

    def test_unreadable_secret_refuses_the_app_code_but_not_a_recovery_code(self, monkeypatch):
        user, secret = make_user(two_factor_on=True)
        codes = start_two_factor(user, 0, now_stamp())
        monkeypatch.setattr(two_factor.settings, "jwt_secret", "changed-secret")
        assert use_code(user, code_at(secret, NOW), NOW) is False
        assert use_code(user, codes[0]) is True

    def test_empty_code(self):
        user, _ = make_user(two_factor_on=True)
        assert use_code(user, "") is False


class TestClearTwoFactor:
    def test_everything_is_gone(self):
        user, _ = make_user(two_factor_on=True)
        start_two_factor(user, 5, now_stamp())
        user.clear_two_factor()
        assert not user.two_factor_enabled
        assert (user.totp_secret, user.totp_last_step, user.recovery_code_hashes) == (None, None, None)

    def test_user_read_shows_the_property(self):
        user, _ = make_user(two_factor_on=True, is_verified=True, hashed_password="x")
        assert UserRead.model_validate(user, from_attributes=True).two_factor_enabled is True
        user.clear_two_factor()
        assert UserRead.model_validate(user, from_attributes=True).two_factor_enabled is False


# --- Tokens ---

class TestPendingToken:
    def test_round_trip(self):
        user, _ = make_user()
        user_id, issued_at = pending_user_id(write_pending_token(user))
        assert user_id == user.id
        assert pending_token_fits(user, issued_at)

    def test_garbage_and_nothing(self):
        assert pending_user_id("not-a-token") is None
        assert pending_user_id(None) is None
        assert pending_user_id("") is None

    @pytest.mark.asyncio
    async def test_access_token_is_not_a_pending_token(self):
        user, _ = make_user()
        assert pending_user_id(await get_jwt_strategy().write_token(user)) is None

    def test_remember_token_is_not_a_pending_token(self):
        user, _ = make_user(two_factor_on=True)
        assert pending_user_id(write_remember_token(user)) is None

    @pytest.mark.asyncio
    async def test_pending_token_is_not_an_access_token(self):
        # The whole point of the pending token: it must open nothing.
        user, _ = make_user()

        class Manager:
            def parse_id(self, value):
                return int(value)

            async def get(self, user_id):
                return user

        assert await get_jwt_strategy().read_token(write_pending_token(user), Manager()) is None
        # The same manager does accept a real access token.
        token = await get_jwt_strategy().write_token(user)
        assert await get_jwt_strategy().read_token(token, Manager()) is user

    def test_expired(self):
        user, _ = make_user()
        token = generate_jwt(
            {"sub": str(user.id), "aud": two_factor.PENDING_AUDIENCE,
             "iat": datetime.now(timezone.utc) - timedelta(hours=1)},
            two_factor.settings.jwt_secret, -1,
        )
        assert pending_user_id(token) is None

    def test_dies_with_a_password_change(self):
        user, _ = make_user()
        _, issued_at = pending_user_id(write_pending_token(user))
        user.password_changed_at = issued_at + timedelta(seconds=1)
        assert not pending_token_fits(user, issued_at)

    def test_dies_when_the_account_is_switched_off(self):
        user, _ = make_user()
        _, issued_at = pending_user_id(write_pending_token(user))
        user.is_active = False
        assert not pending_token_fits(user, issued_at)


class TestRememberedBrowser:
    def test_remembered(self):
        user, _ = make_user(two_factor_on=True)
        assert browser_is_remembered(write_remember_token(user), user) is True

    def test_no_cookie(self):
        user, _ = make_user(two_factor_on=True)
        assert browser_is_remembered(None, user) is False

    def test_cookie_of_another_user(self):
        user, _ = make_user(two_factor_on=True)
        other, _ = make_user(two_factor_on=True, id=8)
        assert browser_is_remembered(write_remember_token(other), user) is False

    def test_pending_token_is_not_a_remember_token(self):
        user, _ = make_user(two_factor_on=True)
        assert browser_is_remembered(write_pending_token(user), user) is False

    def test_forgotten_after_a_password_change(self):
        user, _ = make_user(two_factor_on=True)
        token = write_remember_token(user)
        user.password_changed_at = now_stamp() + timedelta(seconds=5)
        assert browser_is_remembered(token, user) is False

    def test_forgotten_after_a_new_setup(self):
        user, _ = make_user(two_factor_on=True)
        token = write_remember_token(user)
        user.clear_two_factor()
        start_two_factor(user, 0, now_stamp() + timedelta(seconds=5))
        assert browser_is_remembered(token, user) is False

    def test_means_nothing_while_two_factor_is_off(self):
        user, _ = make_user(two_factor_on=True)
        token = write_remember_token(user)
        user.clear_two_factor()
        assert browser_is_remembered(token, user) is False

    def test_stamp_in_the_same_second_keeps_the_browser(self):
        # Switching on and remembering in the same second. With a stamp that
        # has microseconds the cookie would be older than the stamp.
        user, _ = make_user()
        start_two_factor(user, 0, now_stamp())
        assert user.two_factor_enabled_at.microsecond == 0
        assert browser_is_remembered(write_remember_token(user), user) is True


class TestLoginOutcome:
    @pytest.mark.parametrize("enabled, required, remembered, outcome", [
        (False, False, False, TOKEN),
        (False, False, True, TOKEN),
        (False, True, False, SETUP_REQUIRED),
        (False, True, True, SETUP_REQUIRED),
        (True, False, False, CODE_REQUIRED),
        (True, False, True, TOKEN),
        (True, True, False, CODE_REQUIRED),
        (True, True, True, TOKEN),
    ])
    def test_every_case(self, enabled, required, remembered, outcome):
        assert login_outcome(enabled, required, remembered) == outcome


# --- The wrong-code counter ---

class FakeRedis:
    def __init__(self, broken=False):
        self.counts = {}
        self.expires = {}
        self.broken = broken

    def _check(self):
        if self.broken:
            raise ConnectionError("redis is down")

    async def get(self, key):
        self._check()
        return self.counts.get(key)

    async def incr(self, key):
        self._check()
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key, seconds):
        self._check()
        self.expires[key] = seconds


@pytest.fixture
def fake_redis(monkeypatch):
    client = FakeRedis()
    monkeypatch.setattr(rate_limit, "_client", lambda: client)
    return client


class TestWrongCodeCounter:
    @pytest.mark.asyncio
    async def test_blocks_after_the_limit(self, fake_redis):
        for _ in range(TWO_FACTOR_MAX_FAILURES):
            await two_factor_attempt_allowed(7)
            await count_two_factor_failure(7)
        with pytest.raises(HTTPException) as error:
            await two_factor_attempt_allowed(7)
        assert error.value.status_code == 429

    @pytest.mark.asyncio
    async def test_counts_per_account(self, fake_redis):
        for _ in range(TWO_FACTOR_MAX_FAILURES):
            await count_two_factor_failure(7)
        await two_factor_attempt_allowed(8)  # must not raise

    @pytest.mark.asyncio
    async def test_window_starts_at_the_first_wrong_code(self, fake_redis):
        await count_two_factor_failure(7)
        await count_two_factor_failure(7)
        assert list(fake_redis.expires.values()) == [rate_limit.TWO_FACTOR_WINDOW_SECONDS]

    @pytest.mark.asyncio
    async def test_fails_closed_when_redis_is_down(self, monkeypatch):
        # The opposite of the login throttle: without the counter nothing
        # bounds the guessing, so no code is accepted.
        monkeypatch.setattr(rate_limit, "_client", lambda: FakeRedis(broken=True))
        with pytest.raises(HTTPException) as error:
            await two_factor_attempt_allowed(7)
        assert error.value.status_code == 503
        with pytest.raises(HTTPException) as error:
            await count_two_factor_failure(7)
        assert error.value.status_code == 503


# --- The routes ---

class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeDb:
    """Hands out one user, and remembers whether the request committed."""

    def __init__(self, user, required=False):
        self.user = user
        self.required = required
        self.commits = 0

    async def execute(self, statement):
        return FakeResult(self.user)

    async def scalar(self, statement):
        return self.required

    async def commit(self):
        self.commits += 1


class FakeRequest:
    def __init__(self, headers=None):
        self.headers = headers or {}


@pytest.fixture
def notices(monkeypatch):
    """Catch the notice emails instead of sending them."""
    sent = []

    async def fake_send(email, event):
        sent.append((email, event))

    monkeypatch.setattr(two_factor_routes, "send_notice", fake_send)
    return sent


async def raises(detail, awaitable):
    with pytest.raises(HTTPException) as error:
        await awaitable
    assert error.value.detail == detail
    return error.value


class TestLoginWithCode:
    @pytest.mark.asyncio
    async def test_right_code_logs_in_and_commits_the_step(self, fake_redis):
        user, secret = make_user(two_factor_on=True)
        db = FakeDb(user)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user), code=code_at(secret, time.time()),
        )
        response = Response()
        result = await two_factor_routes.login_with_code(body, FakeRequest(), response, db)
        assert result["token_type"] == "bearer" and result["access_token"]
        assert db.commits == 1 and user.totp_last_step is not None
        assert "set-cookie" not in response.headers

    @pytest.mark.asyncio
    async def test_same_code_a_second_time(self, fake_redis):
        user, secret = make_user(two_factor_on=True)
        db = FakeDb(user)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user), code=code_at(secret, time.time()),
        )
        await two_factor_routes.login_with_code(body, FakeRequest(), Response(), db)
        await raises("TWO_FACTOR_BAD_CODE", two_factor_routes.login_with_code(
            body, FakeRequest(), Response(), db,
        ))

    @pytest.mark.asyncio
    async def test_wrong_code_is_a_400_and_is_counted(self, fake_redis):
        user, _ = make_user(two_factor_on=True)
        db = FakeDb(user)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user), code="AAAA-AAAA-AAAA-AAAA",
        )
        error = await raises("TWO_FACTOR_BAD_CODE", two_factor_routes.login_with_code(
            body, FakeRequest(), Response(), db,
        ))
        # Not a 401: the frontend sends every 401 back to the login page.
        assert error.status_code == 400
        assert db.commits == 0
        assert list(fake_redis.counts.values()) == [1]

    @pytest.mark.asyncio
    async def test_blocked_account_does_not_get_in_with_the_right_code(self, fake_redis):
        user, secret = make_user(two_factor_on=True)
        for _ in range(TWO_FACTOR_MAX_FAILURES):
            await count_two_factor_failure(user.id)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user), code=code_at(secret, time.time()),
        )
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.login_with_code(body, FakeRequest(), Response(), FakeDb(user))
        assert error.value.status_code == 429

    @pytest.mark.asyncio
    async def test_access_token_in_place_of_the_pending_token(self, fake_redis):
        user, secret = make_user(two_factor_on=True)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=await get_jwt_strategy().write_token(user),
            code=code_at(secret, time.time()),
        )
        await raises("TWO_FACTOR_PENDING_EXPIRED", two_factor_routes.login_with_code(
            body, FakeRequest(), Response(), FakeDb(user),
        ))

    @pytest.mark.asyncio
    async def test_account_without_two_factor(self, fake_redis):
        user, _ = make_user()
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user), code="123456",
        )
        await raises("TWO_FACTOR_NOT_ON", two_factor_routes.login_with_code(
            body, FakeRequest(), Response(), FakeDb(user),
        ))

    @pytest.mark.asyncio
    async def test_remember_sets_a_cookie_the_page_cannot_read(self, fake_redis):
        user, secret = make_user(two_factor_on=True)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user),
            code=code_at(secret, time.time()), remember=True,
        )
        response = Response()
        await two_factor_routes.login_with_code(
            body, FakeRequest({"x-forwarded-proto": "https"}), response, FakeDb(user),
        )
        cookie = response.headers["set-cookie"]
        assert cookie.startswith(f"{two_factor.REMEMBER_COOKIE}=")
        for part in ("HttpOnly", "Secure", "SameSite=strict", "Path=/auth", "Max-Age=2592000"):
            assert part in cookie
        token = cookie.split("=", 1)[1].split(";")[0]
        assert browser_is_remembered(token, user) is True

    @pytest.mark.asyncio
    async def test_cookie_is_not_secure_over_plain_http(self, fake_redis):
        # A server without a certificate, or local development. A Secure
        # cookie would be dropped there and the user asked for a code forever.
        user, secret = make_user(two_factor_on=True)
        body = two_factor_routes.LoginCodeRequest(
            pending_token=write_pending_token(user),
            code=code_at(secret, time.time()), remember=True,
        )
        response = Response()
        await two_factor_routes.login_with_code(body, FakeRequest(), response, FakeDb(user))
        assert "Secure" not in response.headers["set-cookie"]


class TestSetupAndEnable:
    @pytest.mark.asyncio
    async def test_setup_then_enable_from_a_session(self, fake_redis, notices):
        user, _ = make_user()
        db = FakeDb(user)
        started = await two_factor_routes.setup(two_factor_routes.PendingRequest(), db, user)
        assert not user.two_factor_enabled
        assert started["key"] == secret_as_text(decrypt_secret(user.totp_secret))

        secret = decrypt_secret(user.totp_secret)
        result = await two_factor_routes.enable(
            two_factor_routes.EnableRequest(code=code_at(secret, time.time())), db, user,
        )
        assert user.two_factor_enabled
        assert len(result["recovery_codes"]) == 10
        assert "access_token" not in result  # already logged in
        assert notices == [(user.email, "enabled")]

    @pytest.mark.asyncio
    async def test_enable_by_pending_token_logs_in(self, fake_redis, notices):
        user, _ = make_user()
        db = FakeDb(user)
        pending = write_pending_token(user)
        await two_factor_routes.setup(two_factor_routes.PendingRequest(pending_token=pending), db, None)
        secret = decrypt_secret(user.totp_secret)
        result = await two_factor_routes.enable(
            two_factor_routes.EnableRequest(pending_token=pending, code=code_at(secret, time.time())),
            db, None,
        )
        assert result["access_token"] and len(result["recovery_codes"]) == 10

    @pytest.mark.asyncio
    async def test_setup_code_cannot_be_used_again_at_login(self, fake_redis, notices):
        user, _ = make_user()
        db = FakeDb(user)
        await two_factor_routes.setup(two_factor_routes.PendingRequest(), db, user)
        code = code_at(decrypt_secret(user.totp_secret), time.time())
        await two_factor_routes.enable(two_factor_routes.EnableRequest(code=code), db, user)
        body = two_factor_routes.LoginCodeRequest(pending_token=write_pending_token(user), code=code)
        await raises("TWO_FACTOR_BAD_CODE", two_factor_routes.login_with_code(
            body, FakeRequest(), Response(), db,
        ))

    @pytest.mark.asyncio
    async def test_pending_token_cannot_replace_an_existing_setup(self, fake_redis):
        # Someone with only the password must not put their own phone on an
        # account that already has two-factor.
        user, secret = make_user(two_factor_on=True)
        stored = user.totp_secret
        pending = two_factor_routes.PendingRequest(pending_token=write_pending_token(user))
        await raises("TWO_FACTOR_ALREADY_ON", two_factor_routes.setup(pending, FakeDb(user), None))
        await raises("TWO_FACTOR_ALREADY_ON", two_factor_routes.enable(
            two_factor_routes.EnableRequest(
                pending_token=pending.pending_token, code=code_at(secret, time.time()),
            ), FakeDb(user), None,
        ))
        assert user.totp_secret == stored

    @pytest.mark.asyncio
    async def test_pending_token_wins_over_a_session_of_another_account(self, fake_redis):
        # A tab still logged in as someone else must not receive the setup.
        user, _ = make_user()
        other, _ = make_user(id=8, email="other@example.org")
        await two_factor_routes.setup(
            two_factor_routes.PendingRequest(pending_token=write_pending_token(user)),
            FakeDb(user), other,
        )
        assert user.totp_secret is not None and other.totp_secret is None

    @pytest.mark.asyncio
    async def test_no_session_and_no_pending_token(self, fake_redis):
        user, _ = make_user()
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.setup(two_factor_routes.PendingRequest(), FakeDb(user), None)
        assert error.value.status_code == 401

    @pytest.mark.asyncio
    async def test_enable_without_a_setup(self, fake_redis):
        user, _ = make_user()
        await raises("TWO_FACTOR_NO_SETUP", two_factor_routes.enable(
            two_factor_routes.EnableRequest(code="123456"), FakeDb(user), user,
        ))

    @pytest.mark.asyncio
    async def test_enable_with_a_wrong_code(self, fake_redis, notices):
        user, _ = make_user()
        db = FakeDb(user)
        await two_factor_routes.setup(two_factor_routes.PendingRequest(), db, user)
        await raises("TWO_FACTOR_BAD_CODE", two_factor_routes.enable(
            two_factor_routes.EnableRequest(code="not-a-code"), db, user,
        ))
        assert not user.two_factor_enabled and notices == []

    @pytest.mark.asyncio
    async def test_demo_account_cannot_set_up(self, fake_redis, monkeypatch):
        monkeypatch.setattr(two_factor_routes.settings, "demo_mode", True)
        user, _ = make_user(email=DEMO_USER_EMAIL)
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.setup(two_factor_routes.PendingRequest(), FakeDb(user), user)
        assert error.value.status_code == 403
        assert user.totp_secret is None


class TestDisable:
    @pytest.mark.asyncio
    async def test_with_a_code(self, fake_redis, notices):
        user, secret = make_user(two_factor_on=True)
        db = FakeDb(user)
        await two_factor_routes.disable(
            two_factor_routes.CodeRequest(code=code_at(secret, time.time())), db, user,
        )
        assert not user.two_factor_enabled and db.commits == 1
        assert notices == [(user.email, "disabled")]

    @pytest.mark.asyncio
    async def test_with_a_recovery_code(self, fake_redis, notices):
        user, _ = make_user()
        codes = start_two_factor(user, 0, now_stamp())
        await two_factor_routes.disable(two_factor_routes.CodeRequest(code=codes[0]), FakeDb(user), user)
        assert not user.two_factor_enabled

    @pytest.mark.asyncio
    async def test_a_login_alone_is_not_enough(self, fake_redis, notices):
        user, _ = make_user(two_factor_on=True)
        await raises("TWO_FACTOR_BAD_CODE", two_factor_routes.disable(
            two_factor_routes.CodeRequest(code="AAAA-AAAA-AAAA-AAAA"), FakeDb(user), user,
        ))
        assert user.two_factor_enabled and notices == []

    @pytest.mark.asyncio
    async def test_refused_while_a_project_requires_it(self, fake_redis, notices):
        user, secret = make_user(two_factor_on=True)
        await raises("TWO_FACTOR_REQUIRED", two_factor_routes.disable(
            two_factor_routes.CodeRequest(code=code_at(secret, time.time())),
            FakeDb(user, required=True), user,
        ))
        assert user.two_factor_enabled

    @pytest.mark.asyncio
    async def test_when_it_is_off_already(self, fake_redis):
        user, _ = make_user()
        await raises("TWO_FACTOR_NOT_ON", two_factor_routes.disable(
            two_factor_routes.CodeRequest(code="123456"), FakeDb(user), user,
        ))


class TestNotices:
    def test_every_event_has_a_wording(self):
        from mailer.sender import TWO_FACTOR_NOTICES
        assert set(TWO_FACTOR_NOTICES) == {"enabled", "disabled", "reset"}

    def test_template_renders(self):
        from mailer.sender import TWO_FACTOR_NOTICES
        from shared.email_renderer import render_email
        heading, message = TWO_FACTOR_NOTICES["reset"]
        html, text = render_email(
            "two_factor_notice.html", heading=heading, message=message, login_url="https://x/login",
        )
        assert heading in html and message in text


# --- Admin resets and the project requirement ---

class TestReset:
    @pytest.mark.asyncio
    async def test_admin_resets_a_user(self, notices):
        admin, _ = make_user(id=1, email="admin@example.org")
        user, _ = make_user(two_factor_on=True)
        db = FakeDb(user)
        assert await two_factor_routes.reset_two_factor(db, user.id, admin) is user
        assert not user.two_factor_enabled and db.commits == 1
        assert notices == [(user.email, "reset")]

    @pytest.mark.asyncio
    async def test_never_for_yourself(self, notices):
        # A stolen login of an admin must not be able to drop the admin's own
        # two-factor without a code.
        admin, _ = make_user(two_factor_on=True)
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.reset_two_factor(FakeDb(admin), admin.id, admin)
        assert error.value.status_code == 400
        assert admin.two_factor_enabled and notices == []

    @pytest.mark.asyncio
    async def test_user_without_two_factor(self, notices):
        admin, _ = make_user(id=1)
        user, _ = make_user()
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.reset_two_factor(FakeDb(user), user.id, admin)
        assert error.value.status_code == 400 and notices == []

    @pytest.mark.asyncio
    async def test_unknown_user(self):
        admin, _ = make_user(id=1)
        with pytest.raises(HTTPException) as error:
            await two_factor_routes.reset_two_factor(FakeDb(None), 99, admin)
        assert error.value.status_code == 404


class TestProjectAdminReset:
    """The project route adds two rules on top of reset_two_factor."""

    @pytest.fixture
    def projects(self, monkeypatch):
        from routers import projects

        async def is_admin(user, project_id, db):
            return True

        monkeypatch.setattr(projects, "can_admin_project", is_admin)
        return projects

    @pytest.mark.asyncio
    async def test_member_is_reset(self, projects, notices):
        admin, _ = make_user(id=1)
        member, _ = make_user(two_factor_on=True)
        result = await projects.reset_project_user_two_factor(3, member.id, FakeDb(member), admin)
        assert not member.two_factor_enabled
        assert member.email in result["message"]

    @pytest.mark.asyncio
    async def test_server_admin_is_out_of_reach(self, projects, notices):
        admin, _ = make_user(id=1)
        server_admin, _ = make_user(two_factor_on=True, is_superuser=True)
        with pytest.raises(HTTPException) as error:
            await projects.reset_project_user_two_factor(3, server_admin.id, FakeDb(server_admin), admin)
        assert error.value.status_code == 403
        assert server_admin.two_factor_enabled and notices == []

    @pytest.mark.asyncio
    async def test_user_outside_the_project(self, projects):
        admin, _ = make_user(id=1)
        with pytest.raises(HTTPException) as error:
            await projects.reset_project_user_two_factor(3, 99, FakeDb(None), admin)
        assert error.value.status_code == 404

    @pytest.mark.asyncio
    async def test_no_admin_of_the_project(self, monkeypatch):
        from routers import projects

        async def is_admin(user, project_id, db):
            return False

        monkeypatch.setattr(projects, "can_admin_project", is_admin)
        viewer, _ = make_user(id=1)
        member, _ = make_user(two_factor_on=True)
        with pytest.raises(HTTPException) as error:
            await projects.reset_project_user_two_factor(3, member.id, FakeDb(member), viewer)
        assert error.value.status_code == 403
        assert member.two_factor_enabled


class TestResponseFields:
    """A forgotten response builder must crash, not answer a silent false."""

    def test_project_fields_are_required(self):
        from routers.projects import ProjectResponse, ProjectUpdate, ProjectUserInfo
        from routers.users import ProjectWithRole
        from routers.admin import UserResponse

        assert ProjectResponse.model_fields["require_two_factor"].is_required()
        assert ProjectWithRole.model_fields["require_two_factor"].is_required()
        assert ProjectUserInfo.model_fields["two_factor_enabled"].is_required()
        assert UserResponse.model_fields["two_factor_enabled"].is_required()
        # In an update it is optional, like every other field
        assert not ProjectUpdate.model_fields["require_two_factor"].is_required()

    def test_update_project_applies_the_switch(self):
        import inspect
        from routers.projects import update_project

        assert "project.require_two_factor = project_data.require_two_factor" in inspect.getsource(update_project)

    def test_every_project_builder_passes_the_switch(self):
        import inspect
        from routers import projects, users

        assert inspect.getsource(projects).count("require_two_factor=project.require_two_factor") == 4
        assert inspect.getsource(users).count("require_two_factor=project.require_two_factor") == 2

    def test_model_default_is_off(self):
        from shared.models import Project

        assert Project.__table__.c.require_two_factor.server_default.arg == "false"
