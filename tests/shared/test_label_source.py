"""Tests for the label source, the one definition of which labels a
statistic counts.

The three sources are read by the SQLAlchemy builders in the API and by the
raw SQL templates in the independence CTE, so the table below is what every
filtered statistic in the app agrees on. A change here changes the numbers on
the dashboard and on five insights pages at once.
"""
import pytest

from shared.label_source import (
    DEFAULT_LABEL_SOURCE,
    LABEL_SOURCES,
    label_scope,
)


class TestScopeTable:
    def test_default_is_merged(self):
        """Every existing caller relies on the default being the merged view."""
        assert DEFAULT_LABEL_SOURCE == "merged"
        assert label_scope(DEFAULT_LABEL_SOURCE) == label_scope("merged")

    def test_merged_takes_human_rows_and_ai_rows_of_unverified_images(self):
        scope = label_scope("merged")
        assert scope.include_verified and scope.include_ai
        assert not scope.ai_all_images
        assert scope.verified_sql == "i.is_verified = true"
        assert scope.ai_sql == "i.is_verified = false"

    def test_verified_takes_human_rows_only(self):
        scope = label_scope("verified")
        assert scope.include_verified and not scope.include_ai
        assert scope.verified_sql == "i.is_verified = true"
        # A template that keeps the AI branch text must still count nothing
        assert scope.ai_sql == "FALSE"

    def test_ai_takes_ai_rows_of_every_image_and_no_human_rows(self):
        scope = label_scope("ai")
        assert not scope.include_verified and scope.include_ai
        assert scope.ai_all_images
        assert scope.verified_sql == "FALSE"
        assert scope.ai_sql == "TRUE"

    def test_every_listed_source_has_a_scope(self):
        for source in LABEL_SOURCES:
            label_scope(source)

    def test_unknown_source_raises(self):
        """A typo must not silently fall back to counting everything."""
        with pytest.raises(ValueError):
            label_scope("all")
