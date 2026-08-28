"""
Tests for the development notification guard.

The dangerous failure is not a dev server leaking one email. It is this guard
blocking a production server, which would silence every alert and report with
nothing but a log line to show for it. So most of what is below asserts that
production keeps sending, under every odd input the setting could hold.
"""
import pytest

from shared import notify_guard


@pytest.fixture
def settings(monkeypatch):
    """Drive the guard by patching the settings it reads."""
    class _S:
        environment = "production"
        dev_notify_emails = ""
        dev_notify_chat_ids = ""

    s = _S()
    monkeypatch.setattr(notify_guard, "get_settings", lambda: s)
    return s


# --- production must never be blocked -------------------------------------

def test_production_sends_to_anyone(settings):
    assert notify_guard.email_allowed("ranger@example.org") == (True, "")
    assert notify_guard.chat_id_allowed("123456") == (True, "")


def test_production_ignores_an_empty_allow_list(settings):
    """The allow-list is a dev-only concept and must not reach production."""
    settings.dev_notify_emails = ""
    settings.dev_notify_chat_ids = ""
    assert notify_guard.email_allowed("ranger@example.org")[0] is True
    assert notify_guard.chat_id_allowed("123456")[0] is True


@pytest.mark.parametrize("value", [
    "production", "PRODUCTION", " production ", "prod", "staging",
    "developement",   # the plausible typo
    "dev", "", "  ", None, "Development ", "development-ish",
])
def test_only_the_exact_word_development_restricts(settings, value):
    """Anything else is treated as production.

    A typo in .env must not be able to silence a real server, so the check is
    an exact match rather than a prefix or a substring.
    """
    settings.environment = value
    if value is not None and value.strip().lower() == "development":
        return  # covered by the dev tests below
    assert notify_guard.is_development() is False
    assert notify_guard.email_allowed("ranger@example.org")[0] is True


def test_the_default_setting_is_production():
    """A server that never sets ENVIRONMENT keeps notifying.

    This is the whole reason the guard keys on environment rather than on the
    domain name, so it is worth pinning.
    """
    from shared.config import Settings
    assert Settings.model_fields["environment"].default == "production"


# --- development is restricted --------------------------------------------

def test_development_with_no_allow_list_blocks_everything(settings):
    settings.environment = "development"
    allowed, reason = notify_guard.email_allowed("ranger@example.org")
    assert allowed is False
    assert "allow-list" in reason

    allowed, reason = notify_guard.chat_id_allowed("123456")
    assert allowed is False
    assert "allow-list" in reason


def test_development_allows_a_listed_address(settings):
    settings.environment = "development"
    settings.dev_notify_emails = "peter@addaxdatascience.com"
    assert notify_guard.email_allowed("peter@addaxdatascience.com")[0] is True


def test_development_blocks_an_unlisted_address(settings):
    settings.environment = "development"
    settings.dev_notify_emails = "peter@addaxdatascience.com"
    allowed, reason = notify_guard.email_allowed("ranger@example.org")
    assert allowed is False
    assert "DEV_NOTIFY_EMAILS" in reason


@pytest.mark.parametrize("raw", [
    "a@x.com,b@x.com",
    "a@x.com, b@x.com",
    " a@x.com ,b@x.com , ",
    "a@x.com,,b@x.com",
])
def test_allow_list_parsing_tolerates_spacing_and_empties(settings, raw):
    settings.environment = "development"
    settings.dev_notify_emails = raw
    assert notify_guard.email_allowed("a@x.com")[0] is True
    assert notify_guard.email_allowed("b@x.com")[0] is True
    assert notify_guard.email_allowed("c@x.com")[0] is False


def test_email_matching_ignores_case(settings):
    """Addresses get typed by humans and stored from several places."""
    settings.environment = "development"
    settings.dev_notify_emails = "Peter@Addaxdatascience.COM"
    assert notify_guard.email_allowed("peter@addaxdatascience.com")[0] is True


def test_missing_recipient_is_blocked_on_dev(settings):
    settings.environment = "development"
    settings.dev_notify_emails = "peter@addaxdatascience.com"
    assert notify_guard.email_allowed(None)[0] is False
    assert notify_guard.email_allowed("")[0] is False


def test_chat_ids_are_matched_exactly(settings):
    """Chat ids are numbers, so a prefix match would be a real hazard."""
    settings.environment = "development"
    settings.dev_notify_chat_ids = "12345"
    assert notify_guard.chat_id_allowed("12345")[0] is True
    assert notify_guard.chat_id_allowed(12345)[0] is True      # int from the DB
    assert notify_guard.chat_id_allowed("123456")[0] is False  # not a prefix
    assert notify_guard.chat_id_allowed("1234")[0] is False


def test_the_two_allow_lists_are_independent(settings):
    """Naming an email must not let Telegram through, and the reverse."""
    settings.environment = "development"
    settings.dev_notify_emails = "peter@addaxdatascience.com"
    settings.dev_notify_chat_ids = ""
    assert notify_guard.email_allowed("peter@addaxdatascience.com")[0] is True
    assert notify_guard.chat_id_allowed("12345")[0] is False
