"""Tests for detection alert rule field validation."""
import os
import sys

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.detection_alert_rules import validate_rule_fields


def check(species=None, site_ids=None, channels=None, hour_from=None,
          hour_to=None, min_group_size=None, cooldown_minutes=None,
          rarity_days=None):
    return validate_rule_fields(
        species if species is not None else ["wolf"],
        site_ids,
        channels if channels is not None else ["telegram"],
        hour_from, hour_to, min_group_size, cooldown_minutes, rarity_days,
    )


class TestSpecies:
    def test_happy_path(self):
        assert check() is None
        assert check(species=["wolf", "wild_boar", "person"]) is None

    def test_empty_rejected(self):
        assert check(species=[]) is not None

    def test_non_string_rejected(self):
        assert check(species=["wolf", 3]) is not None
        assert check(species=[""]) is not None

    def test_repeats_rejected(self):
        assert check(species=["wolf", "wolf"]) is not None


class TestSiteIds:
    def test_null_is_all_sites(self):
        assert check(site_ids=None) is None

    def test_non_empty_list_ok(self):
        assert check(site_ids=[1, 2]) is None

    def test_empty_list_rejected(self):
        # "all sites" has exactly one representation, null
        assert check(site_ids=[]) is not None

    def test_non_int_rejected(self):
        assert check(site_ids=[1, "2"]) is not None

    def test_repeats_rejected(self):
        assert check(site_ids=[1, 1]) is not None


class TestChannels:
    def test_valid_combinations(self):
        assert check(channels=["email"]) is None
        assert check(channels=["telegram"]) is None
        assert check(channels=["email", "telegram"]) is None

    def test_empty_rejected(self):
        assert check(channels=[]) is not None

    def test_unknown_rejected(self):
        assert check(channels=["sms"]) is not None

    def test_repeats_rejected(self):
        assert check(channels=["email", "email"]) is not None


class TestHourWindow:
    def test_both_set_ok(self):
        assert check(hour_from=6, hour_to=10) is None

    def test_wrap_ok(self):
        assert check(hour_from=21, hour_to=5) is None

    def test_one_sided_rejected(self):
        assert check(hour_from=6) is not None
        assert check(hour_to=10) is not None

    def test_out_of_range_rejected(self):
        assert check(hour_from=-1, hour_to=10) is not None
        assert check(hour_from=6, hour_to=24) is not None

    def test_equal_rejected(self):
        # The whole day is expressed by leaving the window off
        assert check(hour_from=6, hour_to=6) is not None


class TestGroupSize:
    def test_bounds(self):
        assert check(min_group_size=2) is None
        assert check(min_group_size=100) is None
        # 1 is always true, the condition would be a no-op
        assert check(min_group_size=1) is not None
        assert check(min_group_size=101) is not None


class TestCooldown:
    def test_bounds(self):
        assert check(cooldown_minutes=1) is None
        assert check(cooldown_minutes=10080) is None
        assert check(cooldown_minutes=0) is not None
        assert check(cooldown_minutes=10081) is not None


class TestRarity:
    def test_bounds(self):
        assert check(rarity_days=1) is None
        assert check(rarity_days=3650) is None
        assert check(rarity_days=0) is not None
        assert check(rarity_days=3651) is not None


class TestEverythingTogether:
    def test_full_rule(self):
        assert check(
            species=["wolf", "wild_boar"],
            site_ids=[3, 4],
            channels=["email", "telegram"],
            hour_from=21, hour_to=5,
            min_group_size=3,
            cooldown_minutes=30,
            rarity_days=60,
        ) is None
