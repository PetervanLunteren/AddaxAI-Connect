"""Single-season occupancy model (MacKenzie et al. 2002).

Fits the simplest M_0 model where psi (occupancy probability) and p
(per-occasion detection probability) are constant across sites and
occasions. The fit runs server-side per species so the Naive occupancy
page can show a model-corrected estimate next to the raw proportion
without requiring users to leave for R.

For anything more sophisticated than M_0 (covariates, time-varying
detection, alternative model comparisons), users export the
detection-history CSV from the same page and run `unmarked::occu()` or
`camtrapR` locally. This file deliberately keeps to the canonical
single-season, constant-parameter form.

Likelihood, for a site i with n_i active occasions and d_i detections:

    if d_i > 0:    psi * p^d_i * (1 - p)^(n_i - d_i)
    if d_i == 0:   psi * (1 - p)^n_i + (1 - psi)

We optimise the negative log-likelihood on the logit-transformed
parameters so the search is unconstrained, then map back to [0, 1].
The 95% Wald CI on psi is built from the inverse Hessian, transformed
back through the logit using the delta method, and clipped to [0, 1].
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import numpy as np
from scipy.optimize import minimize


# Skip rule: with fewer than three sites the model is unidentifiable.
# The user can read the naive proportion off the bar itself.
MIN_SITES_FOR_FIT = 3


@dataclass
class OccupancyFitResult:
    """Output of a single-species occupancy fit. Any field can be `None`
    when the fit was skipped or did not converge."""

    psi: Optional[float]
    p: Optional[float]
    psi_ci_low: Optional[float]
    psi_ci_high: Optional[float]
    n_sites: int
    n_occasions: int
    converged: bool


def _site_log_likelihood(
    n: int, d: int, psi: float, p: float
) -> float:
    """Log-likelihood contribution of one site with n active occasions
    and d detections. Uses np.log1p where helpful to keep numerics
    stable near boundaries."""
    if d > 0:
        return (
            np.log(psi)
            + d * np.log(p)
            + (n - d) * np.log1p(-p)
        )
    # d == 0: either the site is occupied and we missed it n times, or
    # the site is not occupied at all.
    return np.log(psi * (1 - p) ** n + (1 - psi))


def _neg_log_likelihood(
    params: np.ndarray, n_arr: np.ndarray, d_arr: np.ndarray
) -> float:
    """Negative log-likelihood across all sites. Input parameters are
    on the logit scale so the optimiser is unconstrained."""
    logit_psi, logit_p = params
    # Clip the sigmoid arguments so the math stays finite at the extremes.
    psi = 1.0 / (1.0 + np.exp(-np.clip(logit_psi, -30, 30)))
    p = 1.0 / (1.0 + np.exp(-np.clip(logit_p, -30, 30)))
    total = 0.0
    for n, d in zip(n_arr, d_arr):
        if n == 0:
            continue
        total += _site_log_likelihood(int(n), int(d), psi, p)
    return -total


def fit_single_season_occupancy(
    site_histories: List[List[Optional[int]]],
) -> OccupancyFitResult:
    """Fit the M_0 single-season occupancy model and return psi, p, and
    a 95% Wald CI on psi.

    `site_histories` is a list of per-site detection vectors over K
    occasions. Each entry is `1` (detected), `0` (active, no detection),
    or `None` (camera inactive that occasion). Sites with zero active
    occasions are dropped before fitting.
    """
    # Reduce each site to (n_active, n_detected). Cheaper than carrying
    # the per-occasion vectors through the optimiser.
    n_active: List[int] = []
    n_detected: List[int] = []
    for hist in site_histories:
        n = sum(1 for v in hist if v is not None)
        if n == 0:
            continue
        d = sum(1 for v in hist if v == 1)
        n_active.append(n)
        n_detected.append(d)

    n_sites = len(n_active)
    n_occasions = max(n_active) if n_active else 0

    if n_sites < MIN_SITES_FOR_FIT:
        return OccupancyFitResult(
            psi=None, p=None,
            psi_ci_low=None, psi_ci_high=None,
            n_sites=n_sites, n_occasions=n_occasions,
            converged=True,
        )

    n_arr = np.asarray(n_active, dtype=float)
    d_arr = np.asarray(n_detected, dtype=float)
    any_detected = bool((d_arr > 0).any())
    all_detected = bool((d_arr > 0).sum() == n_sites)

    # Boundary cases: the MLE lands on 0 or 1 and the Hessian is
    # singular, so report the boundary value with null CI.
    if not any_detected:
        return OccupancyFitResult(
            psi=0.0, p=None,
            psi_ci_low=None, psi_ci_high=None,
            n_sites=n_sites, n_occasions=n_occasions,
            converged=True,
        )
    if all_detected:
        # psi at the boundary 1.0. p is still identifiable from the
        # detection rate at occupied sites.
        p_hat = float(d_arr.sum() / n_arr.sum())
        return OccupancyFitResult(
            psi=1.0, p=p_hat,
            psi_ci_low=None, psi_ci_high=None,
            n_sites=n_sites, n_occasions=n_occasions,
            converged=True,
        )

    # Starting point: naive proportion for psi, average detection rate
    # at occupied sites for p. Reasonable basin for the optimiser.
    naive_psi = max(min(float((d_arr > 0).sum() / n_sites), 0.99), 0.01)
    occupied_mask = d_arr > 0
    p_init = max(
        min(float(d_arr[occupied_mask].sum() / n_arr[occupied_mask].sum()), 0.99),
        0.01,
    )
    x0 = np.array(
        [np.log(naive_psi / (1 - naive_psi)), np.log(p_init / (1 - p_init))]
    )

    try:
        result = minimize(
            _neg_log_likelihood,
            x0,
            args=(n_arr, d_arr),
            method='Nelder-Mead',
            options={'xatol': 1e-6, 'fatol': 1e-8, 'maxiter': 1000},
        )
    except Exception:
        return OccupancyFitResult(
            psi=None, p=None,
            psi_ci_low=None, psi_ci_high=None,
            n_sites=n_sites, n_occasions=n_occasions,
            converged=False,
        )

    if not result.success:
        return OccupancyFitResult(
            psi=None, p=None,
            psi_ci_low=None, psi_ci_high=None,
            n_sites=n_sites, n_occasions=n_occasions,
            converged=False,
        )

    logit_psi, logit_p = result.x
    psi = 1.0 / (1.0 + np.exp(-logit_psi))
    p = 1.0 / (1.0 + np.exp(-logit_p))

    # Wald CI on psi. Compute the 2x2 numerical Hessian of the negative
    # log-likelihood at the MLE; the inverse is the asymptotic covariance.
    # SE on logit_psi comes from sqrt of the [0,0] entry; we map back to
    # the natural scale by inverse logit on (logit_psi ± 1.96 * se).
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    try:
        hess = _numerical_hessian(_neg_log_likelihood, result.x, n_arr, d_arr)
        cov = np.linalg.inv(hess)
        var_logit_psi = float(cov[0, 0])
        if np.isfinite(var_logit_psi) and var_logit_psi > 0:
            se_logit = float(np.sqrt(var_logit_psi))
            lo = logit_psi - 1.96 * se_logit
            hi = logit_psi + 1.96 * se_logit
            ci_low = float(1.0 / (1.0 + np.exp(-lo)))
            ci_high = float(1.0 / (1.0 + np.exp(-hi)))
            # Clip into [0, 1] in case of numerical drift.
            ci_low = max(0.0, min(1.0, ci_low))
            ci_high = max(0.0, min(1.0, ci_high))
    except (np.linalg.LinAlgError, ValueError):
        # Singular or near-singular Hessian. Report the point estimate
        # without a CI rather than fabricating one.
        ci_low = None
        ci_high = None

    return OccupancyFitResult(
        psi=float(psi),
        p=float(p),
        psi_ci_low=ci_low,
        psi_ci_high=ci_high,
        n_sites=n_sites,
        n_occasions=n_occasions,
        converged=True,
    )


def _numerical_hessian(
    func, x: np.ndarray, *args, eps: float = 1e-5
) -> np.ndarray:
    """Two-point central-difference Hessian. Small + good enough for a
    2D problem; avoids pulling in `numdifftools` for one use."""
    n = len(x)
    hess = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            x_pp = x.copy(); x_pp[i] += eps; x_pp[j] += eps
            x_pm = x.copy(); x_pm[i] += eps; x_pm[j] -= eps
            x_mp = x.copy(); x_mp[i] -= eps; x_mp[j] += eps
            x_mm = x.copy(); x_mm[i] -= eps; x_mm[j] -= eps
            hess[i, j] = (
                func(x_pp, *args) - func(x_pm, *args)
                - func(x_mp, *args) + func(x_mm, *args)
            ) / (4 * eps * eps)
    return hess
