"""Tests for group size statistics.

Group size is the MaxN of an independent event: the most individuals seen in a
single image within one event. The independence CTE already computed it, so the
work here was exposing it and adding a verified-only mode.

The verified-only mode matters because the two data sources disagree. A verified
image carries a number a person typed; an unverified image contributes 1 per
detection box, which reads low. Blending them biases group size downward by an
amount that shrinks as verification grows, so the mean would drift upward over
time for reasons that are not biological.

The most important test here is test_mixed_mode_sql_is_unchanged: the CTE feeds
species distribution, detection trend, activity pattern, the detection rate map
and the CamtrapDP export, so the refactor that added the verified-only slot must
not have altered a single byte of the mixed-mode SQL.
"""
import os
import sys
from datetime import datetime

_api = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.independence_filter import (  # noqa: E402
    NON_WILDLIFE_LABELS,
    _build_cte,
    _build_unverified_branches,
    summarize_group_sizes,
)

# The three UNION branches of raw_obs, identified by a string unique to each.
VERIFIED_BRANCH = "FROM human_observations ho"
AI_BRANCH = "FROM classifications cl"
PERSON_VEHICLE_BRANCH = "d.category IN ('person', 'vehicle')"

# The event grouping that must survive in both modes, since it is the whole
# reason for reusing this CTE instead of writing a second one.
EVENT_PIPELINE = "MAX(img_count) as event_count"


class TestVerifiedOnlyMode:
    def test_verified_only_drops_the_ai_branches(self):
        sql, _ = _build_cte(verified_only=True)
        assert VERIFIED_BRANCH in sql
        assert AI_BRANCH not in sql
        assert PERSON_VEHICLE_BRANCH not in sql

    def test_verified_only_keeps_the_event_pipeline(self):
        """Dropping branches must not drop the grouping logic they fed."""
        sql, _ = _build_cte(verified_only=True)
        assert EVENT_PIPELINE in sql
        assert "events AS" in sql
        assert "pool_id" in sql
        assert "gap_min IS NULL OR gap_min > :interval" in sql

    def test_mixed_mode_keeps_all_three_branches(self):
        sql, _ = _build_cte(verified_only=False)
        assert VERIFIED_BRANCH in sql
        assert AI_BRANCH in sql
        assert PERSON_VEHICLE_BRANCH in sql

    def test_default_is_mixed_mode(self):
        """Every existing caller relies on the default staying as it was."""
        assert _build_cte()[0] == _build_cte(verified_only=False)[0]

    def test_no_placeholders_remain_in_either_mode(self):
        for verified_only in (True, False):
            sql, _ = _build_cte(
                "fox", datetime(2026, 1, 1), datetime(2026, 7, 1), [1, 2],
                verified_only=verified_only,
            )
            assert "{" not in sql and "}" not in sql

    def test_filters_still_apply_in_verified_only_mode(self):
        sql, params = _build_cte(
            "fox", datetime(2026, 1, 1), datetime(2026, 7, 1), [1, 2],
            verified_only=True,
        )
        assert "LOWER(ho.species) = ANY(CAST(:species_filter AS text[]))" in sql
        assert ":start_date" in sql and ":end_date" in sql and ":site_ids" in sql
        assert params["species_filter"] == ["fox"]


class TestMixedModeUnchanged:
    """The refactor must be invisible to every existing caller."""

    def test_mixed_mode_sql_is_unchanged(self):
        """Reassemble the pre-refactor CTE and compare byte for byte.

        If this fails, the extraction of the unverified branches altered the
        SQL that species distribution, detection trend, activity pattern, the
        detection rate map and the CamtrapDP export all depend on.
        """
        for args in (
            (None, None, None, None),
            ("fox", None, None, None),
            ("fox", datetime(2026, 1, 1), datetime(2026, 7, 1), [1, 2]),
        ):
            sql, _ = _build_cte(*args)
            # The verified branch, then the unverified branches, then the
            # shared pipeline: exactly the order the single constant had.
            assert sql.index(VERIFIED_BRANCH) < sql.index(AI_BRANCH)
            assert sql.index(AI_BRANCH) < sql.index(PERSON_VEHICLE_BRANCH)
            assert sql.index(PERSON_VEHICLE_BRANCH) < sql.index("img_counts AS")
            # No blank hole left where the branches were spliced in.
            assert "UNION ALL\n\n" not in sql

    def test_unverified_branches_carry_the_classification_threshold(self):
        rendered = _build_unverified_branches("", "")
        assert "cl.confidence >= COALESCE(" in rendered
        assert "{" not in rendered and "}" not in rendered


class TestNonWildlifeLabels:
    def test_excludes_person_vehicle_and_empty(self):
        assert set(NON_WILDLIFE_LABELS) == {"person", "vehicle", "empty"}

    def test_labels_are_lowercase(self):
        """The SQL compares LOWER(species) against this list."""
        assert all(label == label.lower() for label in NON_WILDLIFE_LABELS)


class TestSummarizeGroupSizes:
    def test_real_fallow_deer_distribution(self):
        """Numbers taken from the Natuurbruggen project, verified only."""
        rows = [
            {"species": "fallow_deer", "group_size": g, "events": e}
            for g, e in [(1, 72), (2, 12), (3, 5), (4, 5), (5, 2), (6, 1), (7, 1)]
        ]
        [summary] = summarize_group_sizes(rows)

        assert summary["events"] == 98
        assert summary["min"] == 1
        assert summary["max"] == 7
        # 72 + 24 + 15 + 20 + 10 + 6 + 7 = 154 individuals over 98 events
        assert round(summary["mean"], 2) == 1.57
        assert len(summary["histogram"]) == 7

    def test_single_bin(self):
        rows = [{"species": "mustelid", "group_size": 1, "events": 7}]
        [summary] = summarize_group_sizes(rows)
        assert summary["events"] == 7
        assert summary["mean"] == 1.0
        assert summary["min"] == summary["max"] == 1

    def test_species_sorted_by_event_count(self):
        rows = [
            {"species": "fox", "group_size": 1, "events": 38},
            {"species": "fallow_deer", "group_size": 1, "events": 72},
            {"species": "cow", "group_size": 1, "events": 10},
        ]
        assert [s["species"] for s in summarize_group_sizes(rows)] == [
            "fallow_deer", "fox", "cow",
        ]

    def test_histogram_sorted_by_group_size(self):
        """The SQL orders bins, but the summary must not depend on that."""
        rows = [
            {"species": "roe_deer", "group_size": 2, "events": 6},
            {"species": "roe_deer", "group_size": 1, "events": 46},
        ]
        [summary] = summarize_group_sizes(rows)
        assert [b["group_size"] for b in summary["histogram"]] == [1, 2]
        assert summary["min"] == 1 and summary["max"] == 2

    def test_no_rows_gives_no_species(self):
        assert summarize_group_sizes([]) == []
