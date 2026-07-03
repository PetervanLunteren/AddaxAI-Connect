"""Tests for shared.geo helpers (the running-mean deployment pin)."""
import random

import pytest

from shared.geo import next_mean_pin


def test_second_reading_averages_equally():
    """After the first fold the pin is the plain mean of both readings."""
    lat, lon, n = next_mean_pin(52.0, 5.0, 1, 52.002, 5.002)
    assert n == 2
    assert lat == pytest.approx(52.001)
    assert lon == pytest.approx(5.001)


def test_count_increments_each_fold():
    lat, lon, n = next_mean_pin(52.0, 5.0, 7, 52.0, 5.0)
    assert n == 8
    assert (lat, lon) == (52.0, 5.0)


def test_pin_converges_on_true_position():
    """Noisy readings around a true spot pull the pin onto that spot, away
    from a bad first fix."""
    true_lat, true_lon = 52.0, 5.0
    # Bad first fix ~150 m north of the true spot (0.00135 deg lat).
    lat, lon, n = 52.00135, 5.0, 1
    rng = random.Random(42)
    for _ in range(200):
        noise = 0.00005  # ~5 m
        lat, lon, n = next_mean_pin(
            lat, lon, n,
            true_lat + rng.uniform(-noise, noise),
            true_lon + rng.uniform(-noise, noise),
        )
    assert n == 201
    # Within ~5 m of the true spot; the 150 m first-fix error is averaged out.
    assert abs(lat - true_lat) < 0.00005
    assert abs(lon - true_lon) < 0.00005


def test_outlier_barely_moves_a_mature_pin():
    """A 215 m outlier folded into a 100-reading mean moves the pin ~2 m."""
    lat, lon, n = next_mean_pin(52.0, 5.0, 100, 52.00194, 5.0)  # ~215 m north
    assert n == 101
    moved_deg = abs(lat - 52.0)
    assert moved_deg < 0.00002  # ~2.2 m


def test_antimeridian_wrap_east_to_west():
    """Readings straddling +/-180 average near 180, not near 0."""
    lat, lon, n = next_mean_pin(-17.0, 179.999, 1, -17.0, -179.999)
    assert n == 2
    assert abs(abs(lon) - 180.0) < 0.01
    assert lat == -17.0


def test_antimeridian_wrap_west_to_east():
    lat, lon, n = next_mean_pin(-17.0, -179.999, 1, -17.0, 179.999)
    assert abs(abs(lon) - 180.0) < 0.01


def test_result_longitude_stays_in_range():
    lat, lon, n = next_mean_pin(-17.0, 179.999, 1, -17.0, -179.997)
    assert -180.0 <= lon <= 180.0
