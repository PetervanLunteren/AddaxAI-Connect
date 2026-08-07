"""Tests for the map metrics groundwork (per-site species breakdown)."""
import inspect
import os
import sys
from collections import namedtuple
from datetime import date

# Add API service to path so we can import the modules directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


Row = namedtuple(
    "Row",
    "deployment_id site_id site_name camera_id deployment_number "
    "start_date end_date lon lat trap_days species detection_count",
)


def _row(deployment_id, site_id, species, count, trap_days=100, camera_id=1,
         deployment_number=1, start=date(2026, 1, 1), end=date(2026, 4, 10)):
    return Row(
        deployment_id=deployment_id,
        site_id=site_id,
        site_name=f"site {site_id}",
        camera_id=camera_id,
        deployment_number=deployment_number,
        start_date=start,
        end_date=end,
        lon=5.0,
        lat=50.0,
        trap_days=trap_days,
        species=species,
        detection_count=count,
    )


class TestPoolMapRows:
    def _pool(self, rows, indep_counts=None):
        from routers.statistics import pool_map_rows

        return pool_map_rows(rows, indep_counts)

    def test_multi_species_deployment_counts_trap_days_once(self):
        # The critical regression: rows are per (deployment, species), a
        # deployment with 2 species must not double its trap_days or its
        # deployment count, or every rate silently deflates
        buckets = self._pool([
            _row(1, 10, "red_deer", 5, trap_days=100),
            _row(1, 10, "wild_boar", 3, trap_days=100),
        ])
        b = buckets[10]
        assert b["trap_days"] == 100
        assert b["deployments"] == 1
        assert b["detections"] == 8
        assert b["species_counts"] == {"red_deer": 5, "wild_boar": 3}

    def test_null_species_and_zero_counts_are_skipped(self):
        # LEFT JOIN artifacts: empty deployments produce a species=None row,
        # and FILTER clauses produce species rows with count 0
        buckets = self._pool([
            _row(1, 10, None, 0),
            _row(2, 10, "fox", 0, camera_id=2),
            _row(2, 10, "badger", 2, camera_id=2),
        ])
        b = buckets[10]
        assert b["species_counts"] == {"badger": 2}
        assert b["detections"] == 2
        assert b["deployments"] == 2  # the empty deployment still adds effort
        assert b["trap_days"] == 200

    def test_species_keys_are_lowercased_and_merged(self):
        # Verified species are human-typed, AI species are model output, the
        # same species can arrive in two casings from the two CTE branches
        buckets = self._pool([
            _row(1, 10, "Red Deer", 4),
            _row(1, 10, "red deer", 6),
        ])
        assert buckets[10]["species_counts"] == {"red deer": 10}

    def test_independence_override_replaces_sql_counts(self):
        buckets = self._pool(
            [
                _row(1, 10, "red_deer", 50, camera_id=7, deployment_number=2),
                _row(1, 10, "wild_boar", 30, camera_id=7, deployment_number=2),
            ],
            indep_counts={(7, 2): {"Red_Deer": 4, "wild_boar": 2}},
        )
        b = buckets[10]
        assert b["species_counts"] == {"red_deer": 4, "wild_boar": 2}
        assert b["detections"] == 6
        assert b["trap_days"] == 100

    def test_independence_override_missing_deployment_means_zero(self):
        buckets = self._pool(
            [_row(1, 10, "fox", 9, camera_id=7, deployment_number=1)],
            indep_counts={},
        )
        assert buckets[10]["detections"] == 0
        assert buckets[10]["species_counts"] == {}

    def test_site_pooling_matches_old_per_deployment_sums(self):
        # Abundance must be unchanged: totals with species granularity equal
        # the naive per-deployment sums of the pre-change shape
        buckets = self._pool([
            _row(1, 10, "fox", 3, trap_days=50),
            _row(2, 10, "fox", 4, trap_days=70, camera_id=2),
            _row(2, 10, "badger", 1, trap_days=70, camera_id=2),
            _row(3, 11, None, 0, trap_days=30, camera_id=3),
        ])
        assert buckets[10]["detections"] == 8
        assert buckets[10]["trap_days"] == 120
        assert buckets[10]["deployments"] == 2
        assert buckets[11]["detections"] == 0
        assert buckets[11]["trap_days"] == 30

    def test_active_deployment_and_date_range(self):
        buckets = self._pool([
            _row(1, 10, "fox", 1, start=date(2026, 2, 1), end=None),
            _row(2, 10, "fox", 1, start=date(2026, 1, 5), end=date(2026, 1, 30), camera_id=2),
        ])
        b = buckets[10]
        assert b["first"] == date(2026, 1, 5)
        assert b["has_active"] is True


class TestMapQuerySource:
    """Source-level guards, same convention as test_map_multi_species.py."""

    def _source(self):
        from routers import statistics

        return inspect.getsource(statistics.get_detection_rate_map)

    def test_all_three_branches_group_by_species(self):
        src = self._source()
        assert "GROUP BY cdp.id, ho.species" in src
        assert "GROUP BY cdp.id, cl.species" in src
        assert "GROUP BY cdp.id, d.category" in src
        assert "GROUP BY deployment_id, species" in src

    def test_species_filter_clauses_untouched(self):
        src = self._source()
        assert src.count("= ANY(CAST(:species_list AS text[]))") == 3

    def test_pooling_goes_through_the_helper(self):
        src = self._source()
        assert "pool_map_rows(rows, indep_counts)" in src


class TestIndependencePerSpecies:
    def test_independence_counts_carry_species(self):
        from utils.independence_filter import get_independent_detection_rate_counts

        src = inspect.getsource(get_independent_detection_rate_counts)
        assert "e.species" in src
        assert "GROUP BY cdp.camera_id, cdp.deployment_number, e.species" in src
