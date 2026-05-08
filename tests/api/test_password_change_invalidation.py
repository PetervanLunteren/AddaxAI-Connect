"""
Tests for the password-change session invalidation logic.

The JWT strategy rejects any token whose `iat` (issued-at) is strictly
before the user's `password_changed_at`. These tests reproduce that
comparison locally so the suite runs without a live database, the same
style as tests/notifications/test_rule_engine.py and
tests/notifications/test_sim_expiry.py.
"""
from datetime import datetime, timedelta, timezone


def token_is_valid(iat, password_changed_at) -> bool:
    """
    Mirrors PasswordChangeAwareJWTStrategy.read_token:

        if password_changed_at is not None and iat < password_changed_at:
            reject
        else:
            accept

    Returns True if the token should be accepted, False if rejected.
    A token without an iat claim (None) is accepted; the 1 h expiration
    keeps the worst case bounded for pre-rollout tokens.
    """
    if iat is None:
        return True
    if password_changed_at is None:
        return True
    return iat >= password_changed_at


class TestTokenAcceptance:
    def test_token_after_password_change_passes(self):
        pwd_changed = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        iat = datetime(2026, 5, 8, 9, 0, 1, tzinfo=timezone.utc)
        assert token_is_valid(iat, pwd_changed) is True

    def test_token_before_password_change_rejected(self):
        pwd_changed = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        iat = datetime(2026, 5, 8, 8, 59, 59, tzinfo=timezone.utc)
        assert token_is_valid(iat, pwd_changed) is False

    def test_simultaneous_iat_and_password_change_passes(self):
        # Strict less-than: a token issued at the exact same second is fine.
        # Avoids a clock-tick edge case clobbering the user's freshly-minted
        # token that the API returned in the change-password response.
        ts = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        assert token_is_valid(ts, ts) is True

    def test_password_never_changed_passes(self):
        iat = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        assert token_is_valid(iat, None) is True

    def test_pre_rollout_token_without_iat_passes(self):
        # Tokens issued by the previous JWTStrategy did not carry iat;
        # those should not be force-logged-out at deploy time.
        pwd_changed = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        assert token_is_valid(None, pwd_changed) is True


class TestRealisticScenarios:
    def test_other_browser_invalidated_on_change(self):
        # Browser A logs in at 08:00, gets token with iat=08:00:00.
        # Browser B logs in at 08:30, gets token with iat=08:30:00.
        # User changes password from B at 09:00, new token issued with iat=09:00.
        # password_changed_at = 09:00.
        # Browser A's old token (iat=08:00) is now invalid.
        # Browser B's new token (iat=09:00) is still valid.
        pwd_changed = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        browser_a_token = datetime(2026, 5, 8, 8, 0, 0, tzinfo=timezone.utc)
        browser_b_new_token = datetime(2026, 5, 8, 9, 0, 0, tzinfo=timezone.utc)
        assert token_is_valid(browser_a_token, pwd_changed) is False
        assert token_is_valid(browser_b_new_token, pwd_changed) is True

    def test_reset_flow_logs_out_everyone(self):
        # Forgot password: user resets at 10:00. password_changed_at = 10:00.
        # Any session token issued before 10:00 is invalidated. The user
        # logs in afresh after the reset, gets a token with iat >= 10:00.
        pwd_changed = datetime(2026, 5, 8, 10, 0, 0, tzinfo=timezone.utc)
        old_session = datetime(2026, 5, 8, 9, 30, 0, tzinfo=timezone.utc)
        post_reset_login = datetime(2026, 5, 8, 10, 0, 5, tzinfo=timezone.utc)
        assert token_is_valid(old_session, pwd_changed) is False
        assert token_is_valid(post_reset_login, pwd_changed) is True
