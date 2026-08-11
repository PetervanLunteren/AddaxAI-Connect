"""
Unit tests for the scheduled species report rule validation.

validate_rule_fields is pure (no database), same convention as the camera
and detection rule validation tests. It returns None when the fields are
valid and an error message string otherwise.
"""
import os
import sys

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.scheduled_reports import validate_rule_fields  # noqa: E402


def check(species=None, frequency="monthly"):
    if species is None:
        species = ["raccoon"]
    return validate_rule_fields(species, frequency)


class TestSpecies:
    def test_single_species_valid(self):
        assert check(species=["raccoon"]) is None

    def test_multiple_species_valid(self):
        assert check(species=["red deer", "wild boar", "roe deer"]) is None

    def test_person_and_vehicle_are_valid_labels(self):
        assert check(species=["person", "vehicle"]) is None

    def test_empty_list_rejected(self):
        assert check(species=[]) is not None

    def test_empty_string_rejected(self):
        assert check(species=["raccoon", ""]) is not None

    def test_non_string_rejected(self):
        assert check(species=["raccoon", 42]) is not None

    def test_duplicates_rejected(self):
        assert check(species=["raccoon", "raccoon"]) is not None


class TestFrequency:
    def test_weekly_valid(self):
        assert check(frequency="weekly") is None

    def test_monthly_valid(self):
        assert check(frequency="monthly") is None

    def test_quarterly_valid(self):
        assert check(frequency="quarterly") is None

    def test_daily_rejected(self):
        assert check(frequency="daily") is not None

    def test_empty_rejected(self):
        assert check(frequency="") is not None

    def test_case_sensitive(self):
        assert check(frequency="Monthly") is not None


class TestTogether:
    def test_valid_combination(self):
        assert validate_rule_fields(["lynx"], "quarterly") is None

    def test_first_error_wins(self):
        # Both fields invalid still returns one message, not a crash
        assert validate_rule_fields([], "hourly") is not None
