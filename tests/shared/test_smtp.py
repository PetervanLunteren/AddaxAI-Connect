"""
Tests for the SMTP settings every mail sender uses.

The rule under test is one line: log in only when a username is set. The two
ways it can go wrong are both silent until a mail is due. An empty username
that still triggers a login fails every send on a relay that needs none, and
half a login (a username without a password) would only show up as an
authentication error at the first invitation.
"""
import pytest

from shared.config import Settings
from shared.smtp import smtp_send_kwargs


def _settings(**overrides) -> Settings:
    """Mail settings as a relay server would have them, plus overrides."""
    values = {
        "mail_server": "smtp-relay.gmail.com",
        "mail_port": 587,
        "mail_username": "",
        "mail_password": "",
        "mail_from": "AddaxAI Connect <connect@example.org>",
        "domain_name": "cam.example.org",
    }
    values.update(overrides)
    return Settings(**values)


# --- login or not ---------------------------------------------------------

def test_relay_without_login():
    """Empty username and password, as an .env with blank lines gives them."""
    kwargs = smtp_send_kwargs(_settings())
    assert kwargs["username"] is None
    assert kwargs["password"] is None


def test_unset_username_and_password_mean_no_login():
    kwargs = smtp_send_kwargs(_settings(mail_username=None, mail_password=None))
    assert kwargs["username"] is None
    assert kwargs["password"] is None


def test_account_with_login_is_unchanged():
    """Self-hosters with a normal SMTP account keep logging in."""
    kwargs = smtp_send_kwargs(_settings(
        mail_server="smtp.example.org",
        mail_username="sender@example.org",
        mail_password="app password",
    ))
    assert kwargs["username"] == "sender@example.org"
    assert kwargs["password"] == "app password"


@pytest.mark.parametrize("username, password", [
    ("sender@example.org", ""),
    ("", "app password"),
])
def test_half_a_login_crashes(username, password):
    with pytest.raises(ValueError, match="together"):
        smtp_send_kwargs(_settings(mail_username=username, mail_password=password))


# --- required settings ----------------------------------------------------

@pytest.mark.parametrize("missing", ["mail_server", "mail_port", "mail_from"])
def test_missing_setting_crashes(missing):
    with pytest.raises(ValueError, match="Email configuration incomplete"):
        smtp_send_kwargs(_settings(**{missing: None}))


# --- connection -----------------------------------------------------------

def test_port_587_uses_starttls():
    kwargs = smtp_send_kwargs(_settings(mail_port=587))
    assert kwargs["start_tls"] is True
    assert kwargs["use_tls"] is False


def test_port_465_uses_implicit_tls():
    kwargs = smtp_send_kwargs(_settings(mail_port=465))
    assert kwargs["use_tls"] is True
    assert kwargs["start_tls"] is False


def test_server_introduces_itself_by_domain_name():
    """Google's relay wants a real name in EHLO, not the container id."""
    kwargs = smtp_send_kwargs(_settings())
    assert kwargs["hostname"] == "smtp-relay.gmail.com"
    assert kwargs["port"] == 587
    assert kwargs["local_hostname"] == "cam.example.org"


def test_no_domain_name_leaves_the_default_name():
    kwargs = smtp_send_kwargs(_settings(domain_name=None))
    assert kwargs["local_hostname"] is None
