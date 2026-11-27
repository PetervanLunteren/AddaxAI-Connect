"""
The one rule for effort (trap-days), for every reader.

A camera counts at a site from its first photo there to its last photo there,
and a period a person fixed counts as the person said. Daily reports do not
count: not every camera type sends them, and photos are the one kind of
evidence every camera has.

Per deployment, in whole days, both ends included:

- first day: start_date. A deployment the GPS made starts at its first photo,
  a stated one where the person said.
- last day: a stated deployment with an end (site_source 'manual') ends on
  its end_date.
  Every other deployment ends on the day of its last photo. Never before the
  first day, so a deployment without photos counts one day.

A deployment the GPS closed because the camera moved therefore stops at its
last photo, not at the day before the move: days the camera may have spent
in a truck are not effort. A camera that went silent stops counting the day
it went silent.

Readers use the SQL fragments with a deployments alias; the window clips to
a screen's date range where it has one. effort_last_day is the same rule in
Python, for rows already loaded.
"""
from datetime import date, datetime
from typing import Optional


def first_day_sql(alias: str = "d") -> str:
    return f"{alias}.start_date"


def last_day_sql(alias: str = "d") -> str:
    return (
        f"(CASE WHEN {alias}.site_source = 'manual' AND {alias}.end_date IS NOT NULL "
        f"THEN {alias}.end_date "
        f"ELSE GREATEST({alias}.start_date, COALESCE(CAST({alias}.last_photo_at AS date), {alias}.start_date)) END)"
    )


def days_sql(alias: str = "d", window_start: Optional[str] = None, window_end: Optional[str] = None) -> str:
    """Effort days of one deployment, clipped to a window when given. The
    window ends are SQL expressions (a bound parameter cast to date, for
    example) and may be NULL at run time, which means no clip on that side."""
    first, last = first_day_sql(alias), last_day_sql(alias)
    if window_start is not None:
        first = f"GREATEST({first}, COALESCE({window_start}, {first}))"
    if window_end is not None:
        last = f"LEAST({last}, COALESCE({window_end}, {last}))"
    return f"GREATEST(0, {last} - {first} + 1)"


def effort_last_day(start_date: date, end_date: Optional[date], last_photo_at: Optional[datetime],
                    site_source: str) -> date:
    """last_day_sql in Python."""
    if site_source == "manual" and end_date is not None:
        return end_date
    return max(start_date, last_photo_at.date() if last_photo_at else start_date)
