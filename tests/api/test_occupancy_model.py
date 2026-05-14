"""Unit tests for the single-season occupancy fitter.

Pure-Python, no DB. The fitter is small enough that we can validate it
with synthetic data drawn from known parameters and check the MLE
recovers those parameters within a tolerance. Boundary cases and the
skip rule are exercised explicitly.
"""
from __future__ import annotations

import os
import sys
import random
from typing import List, Optional

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.occupancy_model import (  # noqa: E402
    MIN_SITES_FOR_FIT,
    fit_single_season_occupancy,
)


def _simulate(
    n_sites: int,
    n_occasions: int,
    psi: float,
    p: float,
    seed: int = 0,
) -> List[List[Optional[int]]]:
    """Draw a synthetic detection-history matrix from known (psi, p).

    Each site is occupied with probability psi. Occupied sites detect
    independently with probability p on each of the n_occasions. No
    inactive cameras in this synthetic data."""
    rng = random.Random(seed)
    out: List[List[Optional[int]]] = []
    for _ in range(n_sites):
        occupied = rng.random() < psi
        history: List[Optional[int]] = []
        for _ in range(n_occasions):
            if occupied and rng.random() < p:
                history.append(1)
            else:
                history.append(0)
        out.append(history)
    return out


class TestRecovery:
    def test_recovers_psi_with_200_sites(self):
        # 200 sites, 7 occasions, psi=0.6, p=0.4. With this n, MLE
        # should land within ~0.05 of the truth most of the time.
        data = _simulate(n_sites=200, n_occasions=7, psi=0.6, p=0.4, seed=42)
        result = fit_single_season_occupancy(data)
        assert result.converged is True
        assert result.psi is not None
        assert abs(result.psi - 0.6) < 0.07
        assert result.p is not None
        assert abs(result.p - 0.4) < 0.07

    def test_ci_contains_true_psi_for_dense_data(self):
        data = _simulate(n_sites=300, n_occasions=10, psi=0.5, p=0.6, seed=7)
        result = fit_single_season_occupancy(data)
        assert result.psi_ci_low is not None
        assert result.psi_ci_high is not None
        assert result.psi_ci_low <= 0.5 <= result.psi_ci_high
        # CI should not be wildly wide on 300 sites x 10 occasions.
        assert (result.psi_ci_high - result.psi_ci_low) < 0.2

    def test_corrected_psi_greater_than_naive_for_imperfect_detection(self):
        # With p=0.3 the naive proportion under-counts occupancy. The
        # fitter should pull psi above the raw detection rate.
        data = _simulate(n_sites=200, n_occasions=5, psi=0.7, p=0.3, seed=11)
        n_detected = sum(1 for site in data if any(v == 1 for v in site))
        naive = n_detected / 200
        result = fit_single_season_occupancy(data)
        assert result.psi is not None
        assert result.psi >= naive - 1e-6


class TestBoundaries:
    def test_zero_detections_returns_psi_zero_no_ci(self):
        data = [[0, 0, 0, 0] for _ in range(10)]
        result = fit_single_season_occupancy(data)
        assert result.psi == 0.0
        assert result.psi_ci_low is None
        assert result.psi_ci_high is None
        assert result.converged is True

    def test_all_sites_detected_returns_psi_one_no_ci(self):
        data = [[1, 0, 1, 0] for _ in range(10)]
        result = fit_single_season_occupancy(data)
        assert result.psi == 1.0
        assert result.psi_ci_low is None
        assert result.psi_ci_high is None
        assert result.p is not None
        assert 0.4 < result.p < 0.6
        assert result.converged is True


class TestSkipAndFailure:
    def test_fewer_than_three_sites_skips_fit(self):
        data = [[1, 0, 0], [0, 1, 0]]
        result = fit_single_season_occupancy(data)
        assert result.psi is None
        assert result.p is None
        assert result.psi_ci_low is None
        assert result.psi_ci_high is None
        assert result.converged is True  # skip is not a failure
        assert result.n_sites == 2
        assert MIN_SITES_FOR_FIT == 3

    def test_empty_input_returns_skip(self):
        result = fit_single_season_occupancy([])
        assert result.psi is None
        assert result.n_sites == 0
        assert result.n_occasions == 0

    def test_inactive_camera_only_drops_from_count(self):
        # Two real sites, one fully-inactive site: should be treated as
        # n_sites=2 and trigger the skip rule.
        data = [
            [1, 0, 1],
            [0, 1, 0],
            [None, None, None],
        ]
        result = fit_single_season_occupancy(data)
        assert result.n_sites == 2
        assert result.psi is None  # below MIN_SITES_FOR_FIT

    def test_partial_inactive_occasions_handled(self):
        # 10 sites, but each has 1 of 3 occasions inactive. Should still
        # fit without error and produce a finite psi.
        data = [
            [1, 0, None],
            [None, 1, 0],
            [0, None, 1],
            [1, None, 0],
            [None, 0, 0],
            [0, 0, None],
            [None, 1, 1],
            [0, None, 0],
            [1, 0, None],
            [None, 0, 1],
        ]
        result = fit_single_season_occupancy(data)
        assert result.converged is True
        assert result.psi is not None
        assert 0.0 <= result.psi <= 1.0
