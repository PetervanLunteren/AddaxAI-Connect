"""Tests for camera tag normalization logic."""
from typing import List, Optional


def normalize_tags(tags: Optional[List[str]]) -> List[str]:
    """
    Copy of the normalize_tags function from services/api/routers/cameras.py.
    Kept in sync for unit testing without FastAPI dependency.
    """
    if not tags:
        return []
    seen = set()
    result = []
    for tag in tags:
        tag = tag.strip().lower().replace(',', '')
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


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
