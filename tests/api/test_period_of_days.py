"""The days of the Set deployment form as a period of camera clock time."""
import os
import sys
from datetime import date, datetime

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.deployments import period_of_days  # noqa: E402


def test_from_the_start_of_the_first_day_to_the_start_of_the_day_after_the_last():
    assert period_of_days(date(2026, 3, 1), date(2026, 3, 5)) == (
        datetime(2026, 3, 1), datetime(2026, 3, 6),
    )


def test_one_day():
    assert period_of_days(date(2026, 3, 1), date(2026, 3, 1)) == (
        datetime(2026, 3, 1), datetime(2026, 3, 2),
    )


def test_no_last_day_is_still_there():
    assert period_of_days(date(2026, 3, 1), None) == (datetime(2026, 3, 1), None)
