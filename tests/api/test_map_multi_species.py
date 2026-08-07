"""Tests for the multi-species detection-rate map (combined abundance)."""
import inspect
import os
import sys

# Add API service to path so we can import the modules directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


class TestBuildFiltersSpecies:
    def test_list_matches_any_of_the_names(self):
        from utils.independence_filter import _build_filters

        verified, unverified, pv, params = _build_filters(
            ["Red Deer", "wild_boar"], None, None,
        )
        assert "= ANY(CAST(:species_filter AS text[]))" in verified
        assert "= ANY(CAST(:species_filter AS text[]))" in unverified
        assert "= ANY(CAST(:species_filter AS text[]))" in pv
        # Params are lowercased so the comparison stays case-insensitive
        assert params["species_filter"] == ["red deer", "wild_boar"]

    def test_single_string_still_works(self):
        # Existing callers (species counts, hourly activity) pass one name
        from utils.independence_filter import _build_filters

        verified, _, _, params = _build_filters("Roe_Deer", None, None)
        assert "= ANY(CAST(:species_filter AS text[]))" in verified
        assert params["species_filter"] == ["roe_deer"]

    def test_no_species_no_clause(self):
        from utils.independence_filter import _build_filters

        verified, unverified, pv, params = _build_filters(None, None, None)
        assert "species_filter" not in params
        assert "ANY" not in verified


class TestDetectionRateMapSource:
    """The map query is raw SQL, so guard its shape at the source level,
    the same convention as test_hour_filter.py."""

    def _source(self):
        from routers import statistics

        return inspect.getsource(statistics.get_detection_rate_map)

    def test_all_three_branches_use_the_species_array(self):
        src = self._source()
        assert src.count("= ANY(CAST(:species_list AS text[]))") == 3
        # The old single-species comparison must be gone
        assert "LOWER(CAST(:species AS text))" not in src

    def test_species_list_is_lowercased_and_split_on_commas(self):
        src = self._source()
        assert "s.strip().lower() for s in species.split(',')" in src

    def test_independence_path_gets_the_same_list(self):
        # With an independence interval active the counts are recomputed by
        # get_independent_detection_rate_counts; it must see the same
        # multi-species filter or the two paths would disagree
        src = self._source()
        assert "species_filter=species_list" in src
