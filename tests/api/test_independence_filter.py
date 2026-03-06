"""Tests for independence interval filter logic and SQL generation."""
import sys
import os
from datetime import datetime

# Add API service to path so we can import the module directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.independence_filter import _build_filters, _build_cte, _INDEPENDENCE_CTE


class TestBuildFilters:
    """Tests for _build_filters() SQL clause generation."""

    def test_no_filters(self):
        v, u, pv, params = _build_filters(None, None, None)
        assert v == ""
        assert u == ""
        assert pv == ""
        assert params == {}

    def test_species_filter(self):
        v, u, pv, params = _build_filters("fox", None, None)
        assert "LOWER(ho.species) = LOWER(:species_filter)" in v
        assert "LOWER(cl.species) = LOWER(:species_filter)" in u
        assert "LOWER(d.category) = LOWER(:species_filter)" in pv
        assert params["species_filter"] == "fox"

    def test_start_date(self):
        dt = datetime(2025, 1, 1)
        v, u, pv, params = _build_filters(None, dt, None)
        assert "i.uploaded_at >= :start_date" in v
        assert "i.uploaded_at >= :start_date" in u
        assert "i.uploaded_at >= :start_date" in pv
        assert params["start_date"] == dt

    def test_end_date(self):
        dt = datetime(2025, 12, 31)
        v, u, pv, params = _build_filters(None, None, dt)
        assert "i.uploaded_at <= :end_date" in v
        assert "i.uploaded_at <= :end_date" in u
        assert "i.uploaded_at <= :end_date" in pv
        assert params["end_date"] == dt

    def test_camera_ids(self):
        ids = [1, 2, 3]
        v, u, pv, params = _build_filters(None, None, None, camera_ids=ids)
        assert "i.camera_id = ANY(:camera_ids)" in v
        assert "i.camera_id = ANY(:camera_ids)" in u
        assert "i.camera_id = ANY(:camera_ids)" in pv
        assert params["camera_ids"] == [1, 2, 3]

    def test_all_filters(self):
        dt_start = datetime(2025, 1, 1)
        dt_end = datetime(2025, 12, 31)
        v, u, pv, params = _build_filters("fox", dt_start, dt_end, [10])
        assert "species_filter" in params
        assert "start_date" in params
        assert "end_date" in params
        assert "camera_ids" in params
        # Each clause should have all four conditions
        for clause in [v, u, pv]:
            assert ":start_date" in clause
            assert ":end_date" in clause
            assert ":camera_ids" in clause


class TestBuildCte:
    """Tests for _build_cte() full CTE generation."""

    def test_no_filters_produces_valid_sql(self):
        sql, params = _build_cte()
        assert "WITH raw_obs AS" in sql
        assert "events AS" in sql
        assert params == {}

    def test_filters_are_injected(self):
        sql, params = _build_cte(species_filter="fox")
        assert "LOWER(ho.species) = LOWER(:species_filter)" in sql
        assert "LOWER(cl.species) = LOWER(:species_filter)" in sql
        assert params["species_filter"] == "fox"

    def test_no_format_placeholders_remain(self):
        """After formatting, no {placeholder} strings should remain."""
        sql, _ = _build_cte()
        assert "{" not in sql
        assert "}" not in sql

    def test_all_filter_combos_produce_clean_sql(self):
        sql, _ = _build_cte(
            species_filter="deer",
            start_date=datetime(2025, 6, 1),
            end_date=datetime(2025, 6, 30),
            camera_ids=[1, 2],
        )
        assert "{" not in sql
        assert "}" not in sql


class TestCtePoolIdStructure:
    """Verify the CTE SQL uses pool_id for camera group merging."""

    def test_pool_id_computed_from_group_id(self):
        """Pool ID should use negated camera_group_id or fall back to camera_id."""
        assert "COALESCE(c.camera_group_id * -1, ic.camera_id) as pool_id" in _INDEPENDENCE_CTE

    def test_gaps_partitioned_by_pool_id(self):
        """Time gaps should be computed per pool, not per camera."""
        assert "PARTITION BY pool_id, species ORDER BY ts" in _INDEPENDENCE_CTE

    def test_events_grouped_by_pool_id(self):
        """Events CTE should group by pool_id, not camera_id."""
        assert "GROUP BY pool_id, species, event_id" in _INDEPENDENCE_CTE

    def test_event_camera_attributed_to_earliest(self):
        """For grouped cameras, the event should be attributed to the earliest detection."""
        assert "(ARRAY_AGG(camera_id ORDER BY ts))[1] as camera_id" in _INDEPENDENCE_CTE

    def test_pool_id_negation_prevents_collision(self):
        """Group IDs are negated so they can't collide with positive camera IDs."""
        assert "camera_group_id * -1" in _INDEPENDENCE_CTE

    def test_ungrouped_cameras_use_own_id(self):
        """Ungrouped cameras (no group) should use their own camera_id as pool_id."""
        # COALESCE(null, camera_id) = camera_id
        assert "COALESCE(c.camera_group_id * -1, ic.camera_id)" in _INDEPENDENCE_CTE

    def test_with_pool_joins_cameras(self):
        """The with_pool CTE must join cameras to access camera_group_id."""
        assert "JOIN cameras c ON ic.camera_id = c.id" in _INDEPENDENCE_CTE

    def test_event_count_uses_max(self):
        """Event count should be the maximum individuals in any single image."""
        assert "MAX(img_count) as event_count" in _INDEPENDENCE_CTE

    def test_new_event_flagged_when_gap_exceeds_interval(self):
        """A new event is flagged when the gap exceeds the interval or is the first observation."""
        assert "gap_min IS NULL OR gap_min > :interval" in _INDEPENDENCE_CTE
