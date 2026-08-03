"""Tests for tag normalization, shared by the camera and site routers."""
import os
import sys

_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.tags import normalize_tags  # noqa: E402


class TestNormalizeTags:
    """Tests for the normalize_tags() helper."""

    def test_none_returns_empty(self):
        assert normalize_tags(None) == []

    def test_empty_list_returns_empty(self):
        assert normalize_tags([]) == []

    def test_basic_tags(self):
        assert normalize_tags(["bridge", "forest"]) == ["bridge", "forest"]

    def test_lowercases(self):
        assert normalize_tags(["Bridge", "FOREST"]) == ["bridge", "forest"]

    def test_strips_whitespace(self):
        assert normalize_tags(["  bridge  ", "forest "]) == ["bridge", "forest"]

    def test_deduplicates(self):
        assert normalize_tags(["bridge", "Bridge", "BRIDGE"]) == ["bridge"]

    def test_removes_empties(self):
        assert normalize_tags(["bridge", "", "  ", "forest"]) == ["bridge", "forest"]

    def test_strips_commas(self):
        assert normalize_tags(["bridge,north", "forest,"]) == ["bridgenorth", "forest"]

    def test_preserves_order(self):
        assert normalize_tags(["zebra", "alpha", "middle"]) == ["zebra", "alpha", "middle"]

    def test_mixed_normalization(self):
        result = normalize_tags(["  Bridge ", "bridge", "", "  Forest Edge  ", "forest edge"])
        assert result == ["bridge", "forest edge"]
