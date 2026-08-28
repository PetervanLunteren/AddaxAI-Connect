"""
Unit tests for the theft watch rule validation.

validate_rule_fields is pure (no database), same convention as the other
rule validation tests. It returns None when the fields are valid and an
error message string otherwise.
"""
import os
import sys

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.theft_watch_rules import validate_rule_fields  # noqa: E402


def check(sensitivity="medium", site_ids=None, channels=None):
    if channels is None:
        channels = ["email"]
    return validate_rule_fields(sensitivity, site_ids, channels)


class TestSensitivity:
    def test_low_valid(self):
        assert check(sensitivity="low") is None

    def test_medium_valid(self):
        assert check(sensitivity="medium") is None

    def test_high_valid(self):
        assert check(sensitivity="high") is None

    def test_unknown_rejected(self):
        assert check(sensitivity="extreme") is not None

    def test_empty_rejected(self):
        assert check(sensitivity="") is not None

    def test_case_sensitive(self):
        assert check(sensitivity="Medium") is not None


class TestSiteIds:
    def test_null_means_all_sites(self):
        assert check(site_ids=None) is None

    def test_non_empty_list_valid(self):
        assert check(site_ids=[1, 2, 3]) is None

    def test_empty_list_rejected(self):
        # "all sites" has exactly one representation, null
        assert check(site_ids=[]) is not None

    def test_non_int_rejected(self):
        assert check(site_ids=[1, "2"]) is not None

    def test_duplicates_rejected(self):
        assert check(site_ids=[1, 1]) is not None


class TestChannels:
    def test_email_valid(self):
        assert check(channels=["email"]) is None

    def test_telegram_valid(self):
        assert check(channels=["telegram"]) is None

    def test_both_valid(self):
        assert check(channels=["email", "telegram"]) is None
        assert check(channels=["earthranger"]) is None

    def test_empty_rejected(self):
        assert check(channels=[]) is not None

    def test_duplicates_rejected(self):
        assert check(channels=["email", "email"]) is not None

    def test_unknown_rejected(self):
        assert check(channels=["sms"]) is not None


class TestTogether:
    def test_valid_combination(self):
        assert validate_rule_fields("high", [4], ["email", "telegram"]) is None

    def test_first_error_wins(self):
        # Multiple invalid fields still return one message, not a crash
        assert validate_rule_fields("wrong", [], []) is not None
