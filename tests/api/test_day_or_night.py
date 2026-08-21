"""Daylight or darkness for one capture moment.

Drives the "Light" line in the image detail panel. The input is a camera
clock reading, naive, interpreted under the server timezone, so the test
uses naive datetimes exactly like the caller does.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.sun_time import day_or_night  # noqa: E402

# Drenthe, where the Dutch cameras sit.
NL = {"lat": 52.8747, "lon": 6.8522, "tz_name": "Europe/Amsterdam"}
# Above the arctic circle, where the sun refuses to rise or set.
SVALBARD = {"lat": 78.22, "lon": 15.65, "tz_name": "Arctic/Longyearbyen"}


class TestNormalLatitudes:
    def test_midday_in_summer_is_day(self):
        assert day_or_night(datetime(2026, 6, 21, 13, 0), **NL) == "day"

    def test_midnight_in_summer_is_night(self):
        assert day_or_night(datetime(2026, 6, 21, 1, 0), **NL) == "night"

    def test_early_morning_in_winter_is_night(self):
        """07:00 is daylight in June and darkness in December at this
        latitude. A fixed hour cut-off would get this wrong."""
        assert day_or_night(datetime(2026, 12, 21, 7, 0), **NL) == "night"

    def test_the_same_hour_in_summer_is_day(self):
        assert day_or_night(datetime(2026, 6, 21, 7, 0), **NL) == "day"


class TestPolarDates:
    @pytest.mark.parametrize(
        "moment",
        [
            datetime(2026, 6, 21, 13, 0),  # midnight sun, no sunrise
            datetime(2026, 12, 21, 13, 0),  # polar night, no sunset
        ],
    )
    def test_returns_none_when_the_sun_cannot_be_placed(self, moment):
        """Better an empty row than a confident wrong answer."""
        assert day_or_night(moment, **SVALBARD) is None
