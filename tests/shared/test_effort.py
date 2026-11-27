"""The one effort rule (shared/effort.py): a camera counts at a site from its
first photo there to its last photo there, a stated deployment as the person said."""
from datetime import date, datetime

from shared.effort import days_sql, effort_last_day, last_day_sql


def test_an_open_deployment_ends_on_the_day_of_its_last_photo():
    assert effort_last_day(date(2026, 3, 1), None, datetime(2026, 3, 20, 23, 50), "auto") == date(2026, 3, 20)


def test_a_closed_gps_deployment_also_ends_at_its_last_photo():
    """The camera moved on the 25th, but its last photo here was the 20th."""
    assert effort_last_day(date(2026, 3, 1), date(2026, 3, 24), datetime(2026, 3, 20), "auto") == date(2026, 3, 20)


def test_a_closed_fixed_period_ends_where_the_person_said():
    assert effort_last_day(date(2026, 3, 1), date(2026, 3, 24), datetime(2026, 3, 20), "manual") == date(2026, 3, 24)


def test_an_open_fixed_period_ends_at_its_last_photo():
    assert effort_last_day(date(2026, 3, 1), None, datetime(2026, 3, 20), "manual") == date(2026, 3, 20)


def test_a_deployment_without_photos_counts_its_first_day():
    assert effort_last_day(date(2026, 3, 1), None, None, "manual") == date(2026, 3, 1)


def test_the_sql_says_the_same():
    sql = last_day_sql("d")
    assert "d.site_source = 'manual' AND d.end_date IS NOT NULL" in sql
    assert "CAST(d.last_photo_at AS date)" in sql


def test_a_window_clips_both_ends_and_may_be_null():
    sql = days_sql("d", "CAST(:a AS date)", "CAST(:b AS date)")
    assert "COALESCE(CAST(:a AS date), d.start_date)" in sql
    assert sql.startswith("GREATEST(0, LEAST(")
