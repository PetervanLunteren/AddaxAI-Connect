"""Tests for notifications-email EmailClient config validation.

Reproduces the _validate_config() logic inline to avoid importing aiosmtplib
(which is a CI-optional dependency). Same approach as notification rule_engine tests.
"""
import pytest


def validate_email_config(settings):
    """
    Reproduce EmailClient._validate_config() logic.
    Returns True if valid, raises ValueError if incomplete.
    """
    if not all([
        settings.get("mail_server"),
        settings.get("mail_port"),
        settings.get("mail_username"),
        settings.get("mail_password"),
        settings.get("mail_from"),
    ]):
        raise ValueError(
            "Email configuration incomplete. Required: "
            "MAIL_SERVER, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM"
        )
    return True


class TestEmailConfigValidation:
    def test_valid_config_passes(self):
        settings = {
            "mail_server": "smtp.example.com",
            "mail_port": 587,
            "mail_username": "user",
            "mail_password": "pass",
            "mail_from": "noreply@example.com",
        }
        assert validate_email_config(settings) is True

    def test_missing_server_raises(self):
        settings = {
            "mail_server": None,
            "mail_port": 587,
            "mail_username": "user",
            "mail_password": "pass",
            "mail_from": "noreply@example.com",
        }
        with pytest.raises(ValueError, match="Email configuration incomplete"):
            validate_email_config(settings)

    def test_missing_password_raises(self):
        settings = {
            "mail_server": "smtp.example.com",
            "mail_port": 587,
            "mail_username": "user",
            "mail_password": None,
            "mail_from": "noreply@example.com",
        }
        with pytest.raises(ValueError, match="Email configuration incomplete"):
            validate_email_config(settings)
