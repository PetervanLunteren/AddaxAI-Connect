"""
Tests for the SIM expiry alert helpers.

Mirrors the test_rule_engine.py style: small pure functions reproduced here
so the suite runs without a live database.
"""
from datetime import date


def start_of_month_plus(reference: date, months: int) -> date:
    """
    Return the 1st day of the month `months` calendar months after the
    reference's month. Wraps year boundaries cleanly. Mirrors
    sim_expiry._start_of_month_plus.
    """
    year = reference.year
    month = reference.month + months
    while month > 12:
        month -= 12
        year += 1
    return date(year, month, 1)


def matches_threshold(sim_expiry_date, threshold: date) -> bool:
    """
    Return True if a camera with the given sim_expiry_date should appear in
    the alert. Mirrors the SQL filter:
        sim_expiry_date IS NOT NULL AND sim_expiry_date <= threshold
    """
    if sim_expiry_date is None:
        return False
    return sim_expiry_date <= threshold


class TestStartOfMonthPlus:
    def test_mid_month_run(self):
        assert start_of_month_plus(date(2026, 5, 7), 2) == date(2026, 7, 1)

    def test_first_of_month_run(self):
        assert start_of_month_plus(date(2026, 5, 1), 2) == date(2026, 7, 1)

    def test_last_of_month_run(self):
        assert start_of_month_plus(date(2026, 5, 31), 2) == date(2026, 7, 1)

    def test_year_wrap_dec_to_feb(self):
        assert start_of_month_plus(date(2026, 12, 1), 2) == date(2027, 2, 1)

    def test_year_wrap_nov_to_jan(self):
        assert start_of_month_plus(date(2026, 11, 1), 2) == date(2027, 1, 1)

    def test_zero_months_is_first_of_same_month(self):
        assert start_of_month_plus(date(2026, 5, 15), 0) == date(2026, 5, 1)

    def test_one_month(self):
        assert start_of_month_plus(date(2026, 1, 15), 1) == date(2026, 2, 1)

    def test_leap_year_boundary_does_not_matter(self):
        # We always anchor on day 1, so leap days never matter.
        assert start_of_month_plus(date(2024, 1, 31), 1) == date(2024, 2, 1)
        assert start_of_month_plus(date(2024, 12, 31), 2) == date(2025, 2, 1)


class TestThresholdFilter:
    def test_already_expired_matches(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2025, 1, 1), threshold) is True

    def test_expires_today_matches(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2026, 5, 7), threshold) is True

    def test_inside_window_matches(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2026, 6, 15), threshold) is True

    def test_on_threshold_boundary_matches(self):
        # Calendar-aligned: the 1st of run-month+2 itself counts.
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2026, 7, 1), threshold) is True

    def test_one_day_past_threshold_misses(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2026, 7, 2), threshold) is False

    def test_far_future_misses(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(date(2027, 5, 1), threshold) is False

    def test_null_misses(self):
        threshold = date(2026, 7, 1)
        assert matches_threshold(None, threshold) is False


class TestEndToEndScenario:
    def test_may_run_two_month_window(self):
        """
        Simulate the May 1 cron firing with the 2-month lookahead. Cameras
        that expire in May, June, on July 1, or are already expired all
        match. Cameras expiring July 2 or later miss.
        """
        run_date = date(2026, 5, 1)
        threshold = start_of_month_plus(run_date, 2)
        assert threshold == date(2026, 7, 1)

        cases = {
            "expired_long_ago": (date(2024, 1, 1), True),
            "expired_yesterday": (date(2026, 4, 30), True),
            "expires_today": (date(2026, 5, 1), True),
            "expires_in_may": (date(2026, 5, 20), True),
            "expires_in_june": (date(2026, 6, 30), True),
            "expires_on_july_1": (date(2026, 7, 1), True),
            "expires_on_july_2": (date(2026, 7, 2), False),
            "expires_far_out": (date(2027, 1, 1), False),
            "no_date_set": (None, False),
        }
        for label, (sim_date, expected) in cases.items():
            assert matches_threshold(sim_date, threshold) is expected, label

    def test_december_run_wraps_to_february(self):
        run_date = date(2026, 12, 1)
        threshold = start_of_month_plus(run_date, 2)
        assert threshold == date(2027, 2, 1)
        assert matches_threshold(date(2027, 1, 31), threshold) is True
        assert matches_threshold(date(2027, 2, 1), threshold) is True
        assert matches_threshold(date(2027, 2, 2), threshold) is False
