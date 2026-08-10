"""Tests for the site scope helpers behind site-restricted viewers."""
import os
import sys

# Add API service to path so we can import the helpers directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.site_scope import (
    intersect_scope,
    site_in_scope,
    validate_membership_site_ids,
)


class TestIntersectScope:
    def test_both_unrestricted(self):
        assert intersect_scope(None, None) is None

    def test_only_user_filter(self):
        assert intersect_scope(None, [3, 1]) == [3, 1]

    def test_only_membership_scope(self):
        assert intersect_scope([1, 2], None) == [1, 2]

    def test_intersection_preserves_requested_order(self):
        assert intersect_scope([1, 2, 3], [3, 9, 1]) == [3, 1]

    def test_disjoint_is_empty_not_none(self):
        # An empty result must stay a filter that matches nothing, never
        # fall back to "no filter"
        assert intersect_scope([1, 2], [7, 8]) == []

    def test_membership_scope_is_copied(self):
        allowed = [1, 2]
        result = intersect_scope(allowed, None)
        assert result == allowed
        assert result is not allowed


class TestSiteInScope:
    def test_unrestricted_passes_everything(self):
        assert site_in_scope(7, None) is True
        assert site_in_scope(None, None) is True

    def test_member_site_passes(self):
        assert site_in_scope(2, [1, 2]) is True

    def test_other_site_fails(self):
        assert site_in_scope(3, [1, 2]) is False

    def test_siteless_row_fails_closed(self):
        assert site_in_scope(None, [1, 2]) is False

    def test_empty_scope_matches_nothing(self):
        assert site_in_scope(1, []) is False


class TestValidateMembershipSiteIds:
    def test_null_is_all_sites_for_any_role(self):
        assert validate_membership_site_ids("project-viewer", None) is None
        assert validate_membership_site_ids("project-admin", None) is None

    def test_viewer_with_list_ok(self):
        assert validate_membership_site_ids("project-viewer", [1, 2]) is None

    def test_admin_with_list_rejected(self):
        assert validate_membership_site_ids("project-admin", [1]) is not None

    def test_empty_list_rejected(self):
        # "all sites" has exactly one representation, null
        assert validate_membership_site_ids("project-viewer", []) is not None

    def test_non_int_rejected(self):
        assert validate_membership_site_ids("project-viewer", ["1"]) is not None
        assert validate_membership_site_ids("project-viewer", [True]) is not None

    def test_repeats_rejected(self):
        assert validate_membership_site_ids("project-viewer", [1, 1]) is not None
