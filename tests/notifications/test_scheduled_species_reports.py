"""
Unit tests for the scheduled species report logic.

Everything tested here is a pure function (dates in, dicts out), same
convention as the other notifications tests: no database, no clock.
"""
from datetime import date
from types import SimpleNamespace

from scheduled_species_reports import (
    due_frequencies,
    compute_period,
    previous_period,
    period_label,
    rate_per_100,
    delta_label,
    build_species_block,
    build_report_data,
    eligibility_skip_reason,
)


class TestDueFrequencies:
    def test_plain_weekday_nothing_due(self):
        assert due_frequencies(date(2026, 8, 11)) == set()  # a Tuesday

    def test_monday_weekly(self):
        assert due_frequencies(date(2026, 8, 10)) == {"weekly"}

    def test_first_of_plain_month_monthly(self):
        assert due_frequencies(date(2026, 5, 1)) == {"monthly"}  # a Friday

    def test_monday_the_first(self):
        assert due_frequencies(date(2026, 6, 1)) == {"weekly", "monthly"}

    def test_quarter_firsts(self):
        for day in (date(2026, 4, 1), date(2026, 7, 1), date(2026, 10, 1)):
            assert due_frequencies(day) == {"monthly", "quarterly"}, day

    def test_january_first(self):
        assert due_frequencies(date(2026, 1, 1)) == {"monthly", "quarterly"}

    def test_monday_january_first_all_three(self):
        assert date(2029, 1, 1).weekday() == 0
        assert due_frequencies(date(2029, 1, 1)) == {"weekly", "monthly", "quarterly"}


class TestComputePeriod:
    def test_weekly_covers_previous_monday_to_sunday(self):
        assert compute_period("weekly", date(2026, 8, 10)) == (date(2026, 8, 3), date(2026, 8, 9))

    def test_weekly_across_month_boundary(self):
        assert compute_period("weekly", date(2026, 6, 1)) == (date(2026, 5, 25), date(2026, 5, 31))

    def test_monthly_covers_previous_month(self):
        assert compute_period("monthly", date(2026, 8, 1)) == (date(2026, 7, 1), date(2026, 7, 31))

    def test_monthly_leap_february(self):
        assert compute_period("monthly", date(2028, 3, 1)) == (date(2028, 2, 1), date(2028, 2, 29))

    def test_monthly_year_rollover(self):
        assert compute_period("monthly", date(2026, 1, 1)) == (date(2025, 12, 1), date(2025, 12, 31))

    def test_quarterly_covers_previous_quarter(self):
        assert compute_period("quarterly", date(2026, 4, 1)) == (date(2026, 1, 1), date(2026, 3, 31))
        assert compute_period("quarterly", date(2026, 7, 1)) == (date(2026, 4, 1), date(2026, 6, 30))
        assert compute_period("quarterly", date(2026, 10, 1)) == (date(2026, 7, 1), date(2026, 9, 30))

    def test_quarterly_year_rollover(self):
        assert compute_period("quarterly", date(2026, 1, 1)) == (date(2025, 10, 1), date(2025, 12, 31))


class TestPreviousPeriod:
    def test_weekly(self):
        assert previous_period("weekly", date(2026, 8, 3)) == (date(2026, 7, 27), date(2026, 8, 2))

    def test_monthly(self):
        assert previous_period("monthly", date(2026, 7, 1)) == (date(2026, 6, 1), date(2026, 6, 30))

    def test_quarterly_chains_across_year_boundary(self):
        assert previous_period("quarterly", date(2026, 1, 1)) == (date(2025, 10, 1), date(2025, 12, 31))

    def test_previous_period_ends_the_day_before_start(self):
        from datetime import timedelta
        for frequency, start in (
            ("weekly", date(2026, 8, 3)),
            ("monthly", date(2026, 7, 1)),
            ("quarterly", date(2026, 4, 1)),
        ):
            _, prev_end = previous_period(frequency, start)
            assert prev_end == start - timedelta(days=1)


class TestPeriodLabel:
    def test_monthly(self):
        assert period_label("monthly", date(2026, 7, 1), date(2026, 7, 31)) == "July 2026"

    def test_quarterly(self):
        assert period_label("quarterly", date(2026, 1, 1), date(2026, 3, 31)) == "January - March 2026"

    def test_weekly(self):
        label = period_label("weekly", date(2026, 8, 3), date(2026, 8, 9))
        assert label == "August 03 - August 09, 2026"


class TestRateAndDelta:
    def test_rate_rounding(self):
        assert rate_per_100(12, 7) == 171.4

    def test_zero_count_with_effort_is_a_real_zero(self):
        assert rate_per_100(0, 31) == 0.0

    def test_count_without_effort_is_never_a_rate(self):
        assert rate_per_100(3, 0) is None

    def test_delta_labels(self):
        assert delta_label(11) == "+11"
        assert delta_label(-3) == "-3"
        assert delta_label(0) == "0"
        assert delta_label(None) == "n/a"


EFFORT = [
    {"site_id": 1, "site_name": "River bend", "trap_days": 7},
    {"site_id": 2, "site_name": "North ridge", "trap_days": 7},
    {"site_id": 3, "site_name": "Old barn", "trap_days": 0},
]


class TestBuildSpeciesBlock:
    def test_only_detected_sites_get_rows(self):
        # River bend has a detection; North ridge is active but zero, so it
        # is folded into the summary instead of getting its own row.
        block = build_species_block("raccoon", {1: 12}, 5, EFFORT, False)
        assert [row["site_name"] for row in block["rows"]] == ["River bend"]
        assert block["rows"][0]["rate_per_100"] == round(12 / 7 * 100, 1)

    def test_zero_detection_active_sites_collapsed(self):
        block = build_species_block("raccoon", {1: 12}, 5, EFFORT, False)
        assert block["zero_sites"] == 1  # North ridge
        assert block["zero_sites_trap_days"] == 7

    def test_all_zero_detections_has_no_rows_but_counts_zero_sites(self):
        block = build_species_block("raccoon", {}, 5, EFFORT, False)
        assert block["rows"] == []
        assert block["zero_sites"] == 2  # River bend + North ridge
        assert block["zero_sites_trap_days"] == 14
        assert block["active_sites"] == 2

    def test_zero_effort_site_excluded(self):
        block = build_species_block("raccoon", {1: 12}, 5, EFFORT, False)
        assert all(row["site_name"] != "Old barn" for row in block["rows"])
        assert block["active_sites"] == 2

    def test_presence_numbers(self):
        block = build_species_block("raccoon", {1: 12}, 5, EFFORT, False)
        assert block["sites_detected"] == 1
        assert block["presence_line"] == "detected at 1 of 2 active sites"

    def test_delta(self):
        block = build_species_block("raccoon", {1: 12}, 5, EFFORT, False)
        assert block["delta"] == 7
        assert block["delta_label"] == "+7"

    def test_no_prior_effort_suppresses_delta(self):
        block = build_species_block("raccoon", {1: 12}, 0, EFFORT, True)
        assert block["delta"] is None
        assert block["delta_label"] == "n/a"

    def test_unassigned_bucket(self):
        block = build_species_block("raccoon", {1: 12, None: 2}, 0, EFFORT, False)
        assert block["unassigned_count"] == 2
        assert block["total"] == 14  # header total includes unassigned

    def test_count_at_zero_effort_site_shown_without_rate(self):
        block = build_species_block("raccoon", {3: 4}, 0, EFFORT, False)
        freak = [row for row in block["rows"] if row["site_name"] == "Old barn"]
        assert len(freak) == 1
        assert freak[0]["count"] == 4
        assert freak[0]["rate_per_100"] is None
        # Not active, so not part of the presence numbers
        assert block["sites_detected"] == 0

    def test_sort_by_count_then_name(self):
        block = build_species_block("raccoon", {1: 5, 2: 5}, 0, EFFORT, False)
        assert [row["site_name"] for row in block["rows"]] == ["North ridge", "River bend"]


class TestBuildReportData:
    def counts(self, *rows):
        return [
            {"site_id": site_id, "species": species, "count": count}
            for site_id, species, count in rows
        ]

    def test_species_matching_is_case_insensitive(self):
        data = build_report_data(
            ["Lynx Lynx"],
            self.counts((1, "lynx lynx", 3)),
            [], EFFORT, EFFORT, 30,
        )
        assert data["species_blocks"][0]["total"] == 3
        assert data["species_blocks"][0]["label"] == "Lynx Lynx"

    def test_combined_total_is_sum_of_blocks(self):
        data = build_report_data(
            ["raccoon", "wild boar"],
            self.counts((1, "raccoon", 3), (2, "wild boar", 4), (None, "raccoon", 1)),
            self.counts((1, "raccoon", 2)),
            EFFORT, EFFORT, 0,
        )
        assert data["combined"]["total"] == 8
        assert data["combined"]["total"] == sum(b["total"] for b in data["species_blocks"])
        assert data["combined"]["prev_total"] == 2
        assert data["combined"]["delta"] == 6

    def test_counting_labels(self):
        with_interval = build_report_data(["raccoon"], [], [], EFFORT, EFFORT, 30)
        without = build_report_data(["raccoon"], [], [], EFFORT, EFFORT, 0)
        assert "independent events" in with_interval["methods"]["counting_label"]
        assert "30 minute" in with_interval["methods"]["counting_label"]
        assert "raw detections" in without["methods"]["counting_label"]

    def test_effort_warning_boundary(self):
        prev = [{"site_id": 1, "site_name": "A", "trap_days": 100}]

        def data_for(cur_days):
            cur = [{"site_id": 1, "site_name": "A", "trap_days": cur_days}]
            return build_report_data(["raccoon"], [], [], cur, prev, 0)["methods"]

        assert data_for(126)["effort_warning"] is True   # +26%
        assert data_for(125)["effort_warning"] is False  # exactly +25%
        assert data_for(70)["effort_warning"] is True    # -30%
        assert data_for(80)["effort_warning"] is False   # -20%

    def test_no_prior_effort(self):
        empty_prev = [{"site_id": 1, "site_name": "A", "trap_days": 0}]
        methods = build_report_data(["raccoon"], [], [], EFFORT, empty_prev, 0)["methods"]
        assert methods["no_prior_effort"] is True
        assert methods["effort_warning"] is False
        assert methods["effort_change_pct"] is None

    def test_inactive_sites_counted(self):
        data = build_report_data(["raccoon"], [], [], EFFORT, EFFORT, 0)
        assert data["active_sites"] == 2
        assert data["methods"]["inactive_sites"] == 1


class TestEligibility:
    def user(self, superuser=False, email="user@example.org"):
        return SimpleNamespace(is_superuser=superuser, email=email)

    def test_member_passes(self):
        assert eligibility_skip_reason(self.user(), "project-admin", None) is None
        assert eligibility_skip_reason(self.user(), "project-viewer", None) is None

    def test_superuser_without_membership_passes(self):
        assert eligibility_skip_reason(self.user(superuser=True), None, None) is None

    def test_stale_membership_skipped(self):
        assert eligibility_skip_reason(self.user(), None, None) == "no_membership"

    def test_site_restricted_viewer_skipped(self):
        assert eligibility_skip_reason(self.user(), "project-viewer", [1, 2]) == "site_restricted"

    def test_missing_email_skipped(self):
        assert eligibility_skip_reason(self.user(email=""), "project-admin", None) == "no_email_address"
