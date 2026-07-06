"""Tests for activity-overlap math (KDE, Δ, bootstrap CI, diel) and the
Vazquez sun-time transformation. Pure-Python unit tests; no DB.

Pattern mirrors tests/api/test_naive_occupancy.py."""
import os
import sys
from datetime import date, datetime

import numpy as np
import pytest
from sqlalchemy.dialects import postgresql

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.activity_analysis import (  # noqa: E402
    BOOTSTRAP_REPS,
    KDE_GRID_SAMPLES,
    SunBands,
    bootstrap_overlap_ci,
    classify_diel,
    estimator_label,
    fit_circular_kde,
    overlap_coefficient,
    sample_size_warning,
)
from utils.sun_time import (  # noqa: E402
    compute_anchor_bands,
    compute_anchors,
    per_date_sun_phases,
    reference_date_for_sun,
    transform_to_sun_time,
)


class TestFitCircularKde:
    """von Mises KDE shape, normalization, edge cases."""

    def test_empty_input_returns_zeros(self):
        grid, density = fit_circular_kde(np.asarray([]))
        assert grid.shape == (KDE_GRID_SAMPLES,)
        assert density.shape == (KDE_GRID_SAMPLES,)
        assert float(density.sum()) == 0.0

    def test_density_integrates_to_one(self):
        # Uniform-ish input around the clock; density should integrate ~1.0
        times = np.linspace(0.5, 23.5, 24)
        _, density = fit_circular_kde(times)
        dx = 24.0 / KDE_GRID_SAMPLES
        integral = float(density.sum()) * dx
        assert integral == pytest.approx(1.0, rel=1e-6)

    def test_single_observation_peak_at_observation_hour(self):
        grid, density = fit_circular_kde(np.asarray([12.0]))
        peak_idx = int(np.argmax(density))
        peak_hour = float(grid[peak_idx])
        # 240 samples over 24h = 0.1h resolution. Peak must lie within 0.2h.
        assert abs(peak_hour - 12.0) < 0.2

    def test_density_is_periodic_at_midnight(self):
        # A spike at 23.9 should leak into early hours via the circular kernel.
        _, density = fit_circular_kde(np.asarray([23.9]))
        # Density just past midnight should be non-zero.
        assert density[1] > 0.0


class TestOverlapCoefficient:
    """Δ = ∫ min(f_a, f_b) dt."""

    def test_identical_distributions_overlap_one(self):
        times = np.linspace(0.5, 23.5, 24)
        _, d = fit_circular_kde(times)
        assert overlap_coefficient(d, d) == pytest.approx(1.0, rel=1e-6)

    def test_disjoint_distributions_overlap_low(self):
        _, d_day = fit_circular_kde(np.asarray([12.0]))
        _, d_night = fit_circular_kde(np.asarray([0.0]))
        delta = overlap_coefficient(d_day, d_night)
        # Two concentrated peaks 12 h apart on a circular axis should have very
        # little overlap. With κ=5 the tails are wider than a sharp Dirac, so
        # the value sits well below 0.5 but is not zero.
        assert delta < 0.3

    def test_shape_mismatch_raises(self):
        a = np.zeros(10)
        b = np.zeros(11)
        with pytest.raises(ValueError):
            overlap_coefficient(a, b)


class TestBootstrapOverlapCi:
    """Bootstrap CI brackets the point estimate; deterministic by seed."""

    def test_identical_samples_high_delta_with_tight_ci(self):
        rng = np.random.default_rng(0)
        sample = rng.uniform(8.0, 16.0, size=100)
        delta, low, high = bootstrap_overlap_ci(sample, sample.copy())
        # Point estimate from the original (identical) samples must be 1.0;
        # the bootstrap CI sits just below because each resample's two
        # KDEs diverge slightly in finite samples even when the underlying
        # data is identical. This is the expected boundary behaviour.
        assert delta == pytest.approx(1.0, abs=0.001)
        assert 0.0 <= low <= high <= 1.0
        # Tight upper bound (the bootstrap is sampling from identical
        # source data, so both percentiles should sit close to 1).
        assert high >= 0.9

    def test_empty_inputs_return_zeros(self):
        delta, low, high = bootstrap_overlap_ci(np.asarray([]), np.asarray([1.0]))
        assert delta == 0.0
        assert low == 0.0
        assert high == 0.0

    def test_seed_makes_results_deterministic(self):
        rng = np.random.default_rng(1)
        a = rng.uniform(0, 24, size=80)
        b = rng.uniform(0, 24, size=80)
        result1 = bootstrap_overlap_ci(a, b)
        result2 = bootstrap_overlap_ci(a, b)
        assert result1 == result2

    def test_reps_default_matches_constant(self):
        # Sanity check: BOOTSTRAP_REPS is 200 for interactive use;
        # canonical is 10000. If this changes upstream, update the
        # docstring and the response model echo.
        assert BOOTSTRAP_REPS == 200


class TestEstimatorLabel:
    def test_delta1_below_50(self):
        assert estimator_label(0) == "delta1"
        assert estimator_label(49) == "delta1"

    def test_delta4_at_or_above_50(self):
        assert estimator_label(50) == "delta4"
        assert estimator_label(1000) == "delta4"


class TestSampleSizeWarning:
    def test_thresholds(self):
        assert sample_size_warning(0) == "low_n_30"
        assert sample_size_warning(29) == "low_n_30"
        assert sample_size_warning(30) == "low_n_50"
        assert sample_size_warning(49) == "low_n_50"
        assert sample_size_warning(50) == "low_n_75"
        assert sample_size_warning(74) == "low_n_75"
        assert sample_size_warning(75) is None
        assert sample_size_warning(1000) is None


class TestClassifyDiel:
    """Bennie 2014 ≥0.70 dominance rule."""

    def test_short_grid_falls_back_to_cathemeral(self):
        label, _ = classify_diel(np.asarray([0.0]), np.asarray([1.0]), None)
        assert label == "cathemeral"

    def test_diurnal_without_sun_bands(self):
        # All density piled between 06 and 18.
        times = np.full(50, 12.0)
        grid, density = fit_circular_kde(times)
        label, by_phase = classify_diel(grid, density, None)
        assert label == "diurnal"
        assert by_phase["day"] >= 0.70

    def test_nocturnal_without_sun_bands(self):
        times = np.full(50, 0.0)
        grid, density = fit_circular_kde(times)
        label, by_phase = classify_diel(grid, density, None)
        assert label == "nocturnal"
        assert by_phase["night"] >= 0.70

    def test_cathemeral_when_split_evenly(self):
        # Half at noon, half at midnight => below 0.70 in any single phase.
        times = np.concatenate([np.full(50, 0.0), np.full(50, 12.0)])
        grid, density = fit_circular_kde(times)
        label, _ = classify_diel(grid, density, None)
        assert label == "cathemeral"

    def test_crepuscular_with_sun_bands(self):
        # Wider twilight bands so the KDE smoothing (kappa=5, ~1.7 h
        # equivalent) does not spread density out of the band.
        bands = SunBands(dawn=4.0, sunrise=8.0, sunset=18.0, dusk=22.0)
        # Pile density into the dawn / dusk twilight windows.
        times = np.array([6.0, 6.0, 6.0, 20.0, 20.0, 20.0] * 20)
        grid, density = fit_circular_kde(times)
        label, by_phase = classify_diel(grid, density, bands)
        assert label == "crepuscular"
        assert by_phase["twilight"] >= 0.70

    def test_phases_sum_to_one_without_sun_bands(self):
        times = np.array([3.0, 9.0, 15.0, 21.0] * 10)
        grid, density = fit_circular_kde(times)
        _, by_phase = classify_diel(grid, density, None)
        total = by_phase["day"] + by_phase["night"] + by_phase["twilight"]
        assert total == pytest.approx(1.0, abs=1e-6)


class TestSunTime:
    """Vazquez transformation behavior. Uses Amsterdam (NL) so astral
    produces real values year-round."""

    LAT = 52.37
    LON = 4.90
    TZ = "Europe/Amsterdam"

    def test_per_date_sun_phases_dedupes_and_returns_tuples(self):
        d1 = date(2024, 6, 21)
        d2 = date(2024, 6, 21)  # duplicate, should dedupe
        d3 = date(2024, 12, 21)
        out = per_date_sun_phases([d1, d2, d3], lat=self.LAT, lon=self.LON, tz_name=self.TZ)
        assert set(out.keys()) == {d1, d3}
        for v in out.values():
            assert v is None or len(v) == 4

    def test_compute_anchors_returns_means(self):
        d = date(2024, 6, 21)
        phases = per_date_sun_phases([d], lat=self.LAT, lon=self.LON, tz_name=self.TZ)
        anchors = compute_anchors(phases)
        assert anchors is not None
        anchor_sunrise, anchor_sunset = anchors
        assert 0 <= anchor_sunrise < 24
        assert 0 <= anchor_sunset < 24

    def test_compute_anchor_bands_wraps_to_0_24(self):
        d = date(2024, 6, 21)
        phases = per_date_sun_phases([d], lat=self.LAT, lon=self.LON, tz_name=self.TZ)
        bands = compute_anchor_bands(phases)
        assert bands is not None
        for v in bands:
            assert 0 <= v < 24

    def test_transform_to_sun_time_maps_sunrise_to_anchor(self):
        d = date(2024, 6, 21)
        phases = per_date_sun_phases([d], lat=self.LAT, lon=self.LON, tz_name=self.TZ)
        anchors = compute_anchors(phases)
        assert anchors is not None
        anchor_sunrise, anchor_sunset = anchors
        _, sunrise_d, sunset_d, _ = phases[d]  # type: ignore[misc]
        # An observation exactly at the day's sunrise must land on the anchor sunrise.
        out, dropped = transform_to_sun_time(
            [(sunrise_d, d)], phases,
            anchor_sunrise=anchor_sunrise, anchor_sunset=anchor_sunset,
        )
        assert dropped == 0
        assert out[0] == pytest.approx(anchor_sunrise, abs=1e-9)

    def test_transform_drops_polar_observations(self):
        out, dropped = transform_to_sun_time(
            [(12.0, date(2024, 1, 1))],
            {date(2024, 1, 1): None},
            anchor_sunrise=6.0, anchor_sunset=18.0,
        )
        assert out == []
        assert dropped == 1

    def test_reference_date_for_sun_midpoint(self):
        out = reference_date_for_sun(date(2024, 1, 1), date(2024, 1, 31))
        assert out == date(2024, 1, 16)

    def test_reference_date_for_sun_falls_back_to_set_end(self):
        out = reference_date_for_sun(None, date(2024, 6, 15))
        assert out == date(2024, 6, 15)
        out = reference_date_for_sun(date(2024, 3, 5), None)
        assert out == date(2024, 3, 5)


class _FakeResult:
    def all(self):
        return []


class _CompileAssertingSession:
    """AsyncSession stand-in whose execute() forces SQLAlchemy to compile
    the query against the postgres dialect.

    Compilation is where JOIN-inference and missing-select_from bugs raise
    InvalidRequestError, so calling .compile() here surfaces structural
    problems that pure-Python unit tests miss without needing a live
    database. The return value is an empty fake result so the caller's
    iteration / row handling code runs through cleanly.
    """

    def __init__(self) -> None:
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        compiled = query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
        self.compiled_queries.append(str(compiled))
        return _FakeResult()


class TestQueryCompilation:
    """Compile every query the new helpers issue against the postgres dialect.
    These tests would have caught the v1 missing-select_from regression
    before deploy. No DB connection needed."""

    @pytest.mark.asyncio
    async def test_detection_times_query_compiles_for_wildlife(self):
        # Import inside the test so the api/utils/preferred_counts module
        # picks up the same sys.path additions the other tests rely on.
        api_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
        )
        if api_path not in sys.path:
            sys.path.insert(0, api_path)
        from utils.preferred_counts import get_preferred_species_detection_times

        db = _CompileAssertingSession()
        out = await get_preferred_species_detection_times(
            db=db,  # type: ignore[arg-type]
            project_ids=[1],
            species_filter="fox",
            start_date=datetime(2024, 1, 1),
            end_date=datetime(2024, 12, 31),
            site_ids=[1, 2, 3],
        )
        assert out == []
        assert len(db.compiled_queries) == 1
        sql = db.compiled_queries[0]
        # Sanity: the union of the verified + unverified branches actually
        # made it through compilation. (No person/vehicle branch for "fox".)
        assert "human_observations" in sql.lower()
        assert "classifications" in sql.lower()

    @pytest.mark.asyncio
    async def test_detection_times_query_compiles_for_person(self):
        api_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
        )
        if api_path not in sys.path:
            sys.path.insert(0, api_path)
        from utils.preferred_counts import get_preferred_species_detection_times

        db = _CompileAssertingSession()
        out = await get_preferred_species_detection_times(
            db=db,  # type: ignore[arg-type]
            project_ids=[1],
            species_filter="person",
            start_date=None,
            end_date=None,
            site_ids=None,
        )
        assert out == []
        sql = db.compiled_queries[0]
        # Person triggers the third branch joining Detection.category.
        assert "detections" in sql.lower()
