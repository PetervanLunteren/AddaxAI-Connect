"""
Activity-pattern analysis: circular KDE, overlap coefficient, bootstrap CI,
diel classification.

Backs the Insights / Activity overlap page. Implements the same conventions
as the R `overlap` and `activity` packages so results are comparable to the
published camera-trap literature:

- Per-species smoothing: **von Mises kernel density** evaluated on a 240-
  point grid over [0, 24) hours. Reference: Ridout & Linkie 2009 (J Agric
  Biol Environ Stat 14:322-337); `overlap` R package vignette by
  Meredith & Ridout 2014.
- Pairwise overlap: Δ = ∫ min(f_a, f_b) dt over [0, 24].
- Bootstrap CI for Δ: 1000 percentile-bootstrap reps (canonical is 10 000;
  1000 is sufficient for an interactive UI and runs in well under a second).
- Diel classification: Bennie et al. 2014 ≥ 0.70 density-in-phase rule.

Ported verbatim from AddaxAI WebUI's `app/ml/activity_analysis.py` so the
two products are numerically comparable on the same inputs.
"""

from typing import Literal, Optional

import numpy as np
from pydantic import BaseModel


DielClass = Literal["diurnal", "nocturnal", "crepuscular", "cathemeral"]
DeltaEstimator = Literal["delta1", "delta4"]
SampleSizeWarning = Literal["low_n_30", "low_n_50", "low_n_75"]
TimeAxis = Literal["clock", "sun"]


class SunBands(BaseModel):
    """Fractional-hour dawn / sunrise / sunset / dusk for the reference date."""

    dawn: float
    sunrise: float
    sunset: float
    dusk: float


# Number of grid points used to evaluate the KDE on [0, 24).
KDE_GRID_SAMPLES: int = 240
# Default von Mises concentration parameter. ~5 corresponds to a roughly
# 1.7-hour-equivalent kernel bandwidth.
DEFAULT_KAPPA: float = 5.0
# Bootstrap reps for the Δ confidence interval. Canonical is 10 000; 1000
# keeps the interactive endpoint snappy.
BOOTSTRAP_REPS: int = 1000
# Bennie et al. 2014 density-in-phase threshold for diel classification.
DIEL_THRESHOLD: float = 0.70


def fit_circular_kde(
    times_hours: np.ndarray,
    *,
    samples: int = KDE_GRID_SAMPLES,
    kappa: float = DEFAULT_KAPPA,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Fit a circular von Mises KDE to detection times in [0, 24).

    Returns (grid_hours, density) where density integrates to ~1.0 over
    [0, 24) when summed * (24/samples). Empty input returns a flat grid
    of zeros so the caller can render a "no data" state without crashing.
    """
    grid_hours = np.linspace(0.0, 24.0, samples, endpoint=False)
    if len(times_hours) == 0:
        return grid_hours, np.zeros(samples)

    angles = np.asarray(times_hours, dtype=np.float64) * (2.0 * np.pi / 24.0)
    grid_angles = grid_hours * (2.0 * np.pi / 24.0)

    cos_diff = np.cos(grid_angles[None, :] - angles[:, None])
    raw = np.exp(kappa * cos_diff).mean(axis=0)

    dx = 24.0 / samples
    integral = raw.sum() * dx
    if integral == 0.0:
        return grid_hours, np.zeros(samples)
    density_per_hour = raw / integral
    return grid_hours, density_per_hour


def overlap_coefficient(
    density_a: np.ndarray,
    density_b: np.ndarray,
    *,
    samples: int = KDE_GRID_SAMPLES,
) -> float:
    """
    Δ = ∫ min(f_a, f_b) dt over [0, 24]. Both inputs must be evaluated on
    the same uniform grid (use the output of fit_circular_kde with matching
    samples). When both densities each integrate to 1.0, Δ ∈ [0, 1] where
    1.0 = identical distributions and 0.0 = disjoint.
    """
    if density_a.shape != density_b.shape:
        raise ValueError(
            f"density shapes must match, got {density_a.shape} vs {density_b.shape}"
        )
    dx = 24.0 / samples
    return float(np.minimum(density_a, density_b).sum() * dx)


def bootstrap_overlap_ci(
    times_a: np.ndarray,
    times_b: np.ndarray,
    *,
    reps: int = BOOTSTRAP_REPS,
    samples: int = KDE_GRID_SAMPLES,
    kappa: float = DEFAULT_KAPPA,
    seed: int = 42,
) -> tuple[float, float, float]:
    """
    Δ point estimate plus percentile-bootstrap 95% CI. Each species is
    resampled with replacement, KDE refit, Δ recomputed; the 2.5 / 97.5
    percentiles of the bootstrap distribution form the CI. Fixed seed for
    deterministic results.
    """
    times_a = np.asarray(times_a, dtype=np.float64)
    times_b = np.asarray(times_b, dtype=np.float64)
    n_a = len(times_a)
    n_b = len(times_b)
    if n_a == 0 or n_b == 0:
        return 0.0, 0.0, 0.0

    _, density_a = fit_circular_kde(times_a, samples=samples, kappa=kappa)
    _, density_b = fit_circular_kde(times_b, samples=samples, kappa=kappa)
    delta_point = overlap_coefficient(density_a, density_b, samples=samples)

    rng = np.random.default_rng(seed)
    deltas = np.empty(reps, dtype=np.float64)
    for i in range(reps):
        sample_a = rng.choice(times_a, size=n_a, replace=True)
        sample_b = rng.choice(times_b, size=n_b, replace=True)
        _, da = fit_circular_kde(sample_a, samples=samples, kappa=kappa)
        _, db = fit_circular_kde(sample_b, samples=samples, kappa=kappa)
        deltas[i] = overlap_coefficient(da, db, samples=samples)

    ci_low, ci_high = np.percentile(deltas, [2.5, 97.5])
    return delta_point, float(ci_low), float(ci_high)


def estimator_label(min_n: int) -> DeltaEstimator:
    """Conventional Ridout & Linkie 2009 label. Δ4 ≥ 50, Δ1 below."""
    return "delta1" if min_n < 50 else "delta4"


def sample_size_warning(n: int) -> Optional[SampleSizeWarning]:
    """Map n to a UI warning bucket."""
    if n < 30:
        return "low_n_30"
    if n < 50:
        return "low_n_50"
    if n < 75:
        return "low_n_75"
    return None


def classify_diel(
    grid_hours: np.ndarray,
    density: np.ndarray,
    sun_bands: Optional[SunBands],
    *,
    threshold: float = DIEL_THRESHOLD,
) -> tuple[DielClass, dict[str, float]]:
    """
    Classify activity into diurnal / nocturnal / crepuscular / cathemeral.

    Bennie et al. 2014 rule: dominant phase if ≥ threshold of activity
    density falls in that phase; otherwise cathemeral. Without sun bands,
    falls back to a fixed 06:00 / 18:00 day window with no twilight phase.
    """
    if len(grid_hours) < 2:
        return "cathemeral", {"day": 0.0, "night": 0.0, "twilight": 0.0}

    dx = float(grid_hours[1] - grid_hours[0])

    if sun_bands is None:
        day_mask = (grid_hours >= 6.0) & (grid_hours < 18.0)
        day = float(density[day_mask].sum() * dx)
        night = max(0.0, 1.0 - day)
        density_by_phase = {"day": day, "night": night, "twilight": 0.0}
    else:
        day_mask = (grid_hours >= sun_bands.sunrise) & (grid_hours < sun_bands.sunset)
        twilight_mask = (
            ((grid_hours >= sun_bands.dawn) & (grid_hours < sun_bands.sunrise))
            | ((grid_hours >= sun_bands.sunset) & (grid_hours < sun_bands.dusk))
        )
        day = float(density[day_mask].sum() * dx)
        twilight = float(density[twilight_mask].sum() * dx)
        night = max(0.0, 1.0 - day - twilight)
        density_by_phase = {"day": day, "night": night, "twilight": twilight}

    max_phase = max(density_by_phase, key=density_by_phase.__getitem__)
    if density_by_phase[max_phase] >= threshold:
        if max_phase == "day":
            return "diurnal", density_by_phase
        if max_phase == "night":
            return "nocturnal", density_by_phase
        return "crepuscular", density_by_phase
    return "cathemeral", density_by_phase
