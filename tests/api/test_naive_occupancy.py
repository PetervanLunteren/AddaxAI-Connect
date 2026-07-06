"""Tests for naive occupancy SQL and helpers in services/api/utils/preferred_counts.py.

Mirrors the existing pattern in test_independence_filter.py: unit-level SQL
string assertions plus pure-Python logic checks. End-to-end exercise of the
queries against a real Postgres lives in manual verification per the plan.
"""
import os
import sys
from datetime import date, datetime, timedelta

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.preferred_counts import (
    _NAIVE_OCCUPANCY_SQL,
    get_naive_occupancy,
    _occasions,
)


class TestNaiveOccupancySql:
    """The SQL is the correctness surface — assert the shape directly."""

    def test_has_active_sites_cte(self):
        assert "active_sites AS" in _NAIVE_OCCUPANCY_SQL

    def test_active_sites_resolved_through_deployment(self):
        # A site is active when a deployment at it overlaps the window; presence
        # reaches its site through the image's deployment (time-correct).
        assert "cdp.site_id IS NOT NULL" in _NAIVE_OCCUPANCY_SQL
        assert "INNER JOIN deployments dep ON i.deployment_id = dep.id" in _NAIVE_OCCUPANCY_SQL

    def test_active_cameras_join_uses_deployment_overlap(self):
        # The "any overlap with the window" rule: deployment.start <= window_end
        # AND (deployment.end IS NULL OR deployment.end >= window_start).
        assert "cdp.start_date <= CAST(:end_date AS date)" in _NAIVE_OCCUPANCY_SQL
        assert "cdp.end_date IS NULL OR cdp.end_date >= CAST(:start_date AS date)" in _NAIVE_OCCUPANCY_SQL

    def test_has_verified_and_unverified_presence_ctes(self):
        assert "verified_presence AS" in _NAIVE_OCCUPANCY_SQL
        assert "unverified_presence AS" in _NAIVE_OCCUPANCY_SQL

    def test_excludes_hidden_images(self):
        assert _NAIVE_OCCUPANCY_SQL.count("i.is_hidden = FALSE") >= 2

    def test_excludes_person_and_vehicle_in_human_observations(self):
        assert "LOWER(ho.species) NOT IN ('person', 'vehicle')" in _NAIVE_OCCUPANCY_SQL

    def test_unverified_path_gates_on_detection_threshold(self):
        assert "d.confidence >= p.detection_threshold" in _NAIVE_OCCUPANCY_SQL

    def test_unverified_path_gates_on_classification_threshold(self):
        # Mirrors the COALESCE pattern in /detection-rate-map and other endpoints.
        assert "p.classification_thresholds->'overrides'->>cl.species" in _NAIVE_OCCUPANCY_SQL
        assert "p.classification_thresholds->>'default'" in _NAIVE_OCCUPANCY_SQL

    def test_no_person_vehicle_detections_in_unverified_path(self):
        # The unverified path joins through Classification, which only exists for
        # animal detections — so there is no explicit category filter, but the
        # join itself excludes person/vehicle.
        # Defensively, no `Detection.category IN ('person', 'vehicle')` should
        # appear in the unverified CTE (only in the verified-side defensive
        # filter on HumanObservation.species).
        unverified_block = _NAIVE_OCCUPANCY_SQL.split("unverified_presence AS")[1].split("all_presence AS")[0]
        assert "'person'" not in unverified_block
        assert "'vehicle'" not in unverified_block

    def test_final_aggregate_counts_distinct_sites(self):
        # COUNT(DISTINCT site_id) is the per-species occupancy numerator. Cameras
        # at one site collapse to that single site.
        assert "COUNT(DISTINCT site_id)" in _NAIVE_OCCUPANCY_SQL

    def test_independence_interval_not_applied(self):
        # Naive occupancy is independence-immune at the (site, window) level —
        # confirm the SQL has no event-grouping CTE or pool_id terms.
        assert "pool_id" not in _NAIVE_OCCUPANCY_SQL
        assert "INTERVAL" not in _NAIVE_OCCUPANCY_SQL.upper().replace("INTERVAL '1 DAY'", "")

    def test_no_format_placeholders_leak(self):
        assert "{" not in _NAIVE_OCCUPANCY_SQL
        assert "}" not in _NAIVE_OCCUPANCY_SQL


class TestGetNaiveOccupancyEarlyReturn:
    """Empty project list short-circuits without hitting the DB."""

    @pytest.mark.asyncio
    async def test_empty_project_ids_returns_empty(self):
        # db is None — the function must not touch it on the empty-projects path.
        points, sites_total = await get_naive_occupancy(
            db=None,  # type: ignore[arg-type]
            project_ids=[],
            start_date=datetime(2025, 1, 1),
            end_date=datetime(2025, 1, 31),
        )
        assert points == []
        assert sites_total == 0


class TestOccasionGridLogic:
    """The occasion walk in _occasions (used by the site detection history)
    must produce contiguous, non-overlapping ranges covering the window. Uses
    the real function; occasions are 0-indexed.
    """

    def test_daily_occasions_cover_window_one_to_one(self):
        occ = _occasions(date(2025, 1, 1), date(2025, 1, 5), 1)
        assert occ == [
            (0, date(2025, 1, 1), date(2025, 1, 1)),
            (1, date(2025, 1, 2), date(2025, 1, 2)),
            (2, date(2025, 1, 3), date(2025, 1, 3)),
            (3, date(2025, 1, 4), date(2025, 1, 4)),
            (4, date(2025, 1, 5), date(2025, 1, 5)),
        ]

    def test_weekly_occasions_clamp_last_to_window_end(self):
        # 10-day window, 7-day occasions: occasion 0 = days 1-7, occasion 1 = days 8-10.
        occ = _occasions(date(2025, 1, 1), date(2025, 1, 10), 7)
        assert occ == [
            (0, date(2025, 1, 1), date(2025, 1, 7)),
            (1, date(2025, 1, 8), date(2025, 1, 10)),
        ]

    def test_single_day_window(self):
        occ = _occasions(date(2025, 1, 1), date(2025, 1, 1), 7)
        assert occ == [(0, date(2025, 1, 1), date(2025, 1, 1))]

    def test_occasions_are_contiguous_and_non_overlapping(self):
        occ = _occasions(date(2025, 1, 1), date(2025, 6, 30), 14)
        for prev, nxt in zip(occ, occ[1:]):
            assert prev[2] + timedelta(days=1) == nxt[1]
        # First starts at window start, last ends at window end.
        assert occ[0][1] == date(2025, 1, 1)
        assert occ[-1][2] == date(2025, 6, 30)


class TestDeploymentOverlapActiveCheck:
    """The "camera active that occasion" rule: any deployment overlap counts."""

    @staticmethod
    def is_active(deployments, occ_start: date, occ_end: date) -> bool:
        return any(d_start <= occ_end and d_end >= occ_start for d_start, d_end in deployments)

    def test_camera_with_no_deployment_inactive(self):
        assert not self.is_active([], date(2025, 1, 1), date(2025, 1, 7))

    def test_deployment_fully_contains_occasion(self):
        deps = [(date(2025, 1, 1), date(2025, 1, 31))]
        assert self.is_active(deps, date(2025, 1, 5), date(2025, 1, 11))

    def test_deployment_starts_inside_occasion(self):
        deps = [(date(2025, 1, 5), date(2025, 1, 31))]
        assert self.is_active(deps, date(2025, 1, 1), date(2025, 1, 7))

    def test_deployment_ends_inside_occasion(self):
        deps = [(date(2024, 12, 1), date(2025, 1, 5))]
        assert self.is_active(deps, date(2025, 1, 1), date(2025, 1, 7))

    def test_deployment_outside_occasion(self):
        deps = [(date(2025, 2, 1), date(2025, 2, 28))]
        assert not self.is_active(deps, date(2025, 1, 1), date(2025, 1, 7))

    def test_one_day_overlap_counts_as_active(self):
        # A camera deployed for the very last day of the occasion still counts —
        # matches the chart's "any overlap" denominator rule. Per the plan, a
        # stricter ≥50%-overlap option is a follow-up.
        deps = [(date(2025, 1, 7), date(2025, 1, 7))]
        assert self.is_active(deps, date(2025, 1, 1), date(2025, 1, 7))
