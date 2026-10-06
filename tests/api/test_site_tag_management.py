"""Tests for project-wide site tag rename and delete (Quentin's point 12)."""
import inspect
import os
import sys

_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.tags import rename_tag_in_list  # noqa: E402


class TestRenameTagInList:
    def test_renames_in_place(self):
        assert rename_tag_in_list(["bridge", "forest"], "bridge", "wetland") == [
            "wetland", "forest",
        ]

    def test_rename_onto_existing_tag_merges(self):
        # The duplicate collapses and the renamed tag keeps its position.
        assert rename_tag_in_list(["bridge", "forest"], "bridge", "forest") == [
            "forest",
        ]

    def test_rows_without_the_tag_are_untouched(self):
        assert rename_tag_in_list(["forest"], "bridge", "wetland") == ["forest"]

    def test_new_tag_is_normalized(self):
        assert rename_tag_in_list(["bridge"], "bridge", "  Wet,land ") == ["wetland"]

    def test_none_list(self):
        assert rename_tag_in_list(None, "bridge", "wetland") == []


class TestTagEndpointsSource:
    """Source-level guards, same convention as test_map_metrics.py."""

    def _module_source(self):
        from routers import sites

        return inspect.getsource(sites)

    def test_both_endpoints_require_project_admin(self):
        from routers import sites

        for fn in (sites.rename_site_tag, sites.delete_site_tag):
            sig = str(inspect.signature(fn))
            assert "require_project_admin_access" in sig

    def test_literal_tag_routes_come_before_the_site_id_route(self):
        # FastAPI matches routes in declaration order. Declared after
        # /{site_id}, "tags" would be coerced to site_id: int and 422,
        # the same gotcha the bulk routes document.
        src = self._module_source()
        assert src.index('"/tags/rename"') < src.index('"/{site_id}"')
        assert src.index('"/tags/delete"') < src.index('"/{site_id}"')

    def test_rename_goes_through_the_shared_helper(self):
        src = inspect.getsource(__import__("routers.sites", fromlist=["x"]).rename_site_tag)
        assert "rename_tag_in_list(" in src
