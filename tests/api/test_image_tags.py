"""Tests for image tags (customisable flags on images)."""
import inspect
import os
import sys

# Add API service to path so we can import the modules directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Image


class TestModel:
    def test_image_has_tags_column(self):
        assert hasattr(Image, "tags")


class TestRouteOrdering:
    def test_tags_route_is_declared_before_the_uuid_route(self):
        """GET /api/images/tags must be registered before GET /{uuid}, or
        "tags" gets swallowed as a uuid and the endpoint 404s. Classic
        trap, same guard as sites and cameras carry in comments."""
        from routers import images as images_router

        paths = [r.path for r in images_router.router.routes]
        assert "/api/images/tags" in paths
        assert paths.index("/api/images/tags") < paths.index("/api/images/{uuid}")


class TestSetTags:
    def test_writes_go_through_normalize_tags(self):
        # One normalization rule for sites, cameras, and images. A raw
        # assignment would let "Infraction" and "infraction" split the
        # vocabulary.
        from routers.images import set_image_tags

        src = inspect.getsource(set_image_tags)
        assert "normalize_tags(request.tags)" in src

    def test_any_member_may_tag_no_role_check(self):
        # Same permission rule as the like and needs-review flags
        from routers.images import set_image_tags

        src = inspect.getsource(set_image_tags)
        assert "accessible_project_ids" in src
        assert "can_admin_project" not in src


class TestListFilter:
    def test_filter_matches_any_of_the_tags_on_the_image(self):
        from routers.images import list_images

        src = inspect.getsource(list_images)
        assert "cast(Image.tags, JSONB).has_any" in src
        # Input normalized so it matches the stored lowercase form
        assert "normalize_tags(image_tags.split(','))" in src


class TestExport:
    def test_header_and_all_three_row_sites_carry_the_tags_column(self):
        """The three rows.append sites (human, AI, blank) must stay
        column-aligned with the header. A missed site silently shifts
        columns in the CSV."""
        from routers import export

        src = inspect.getsource(export._build_observation_rows)
        assert '"image_tags"' in src
        assert src.count('",".join(image.tags) if image.tags else ""') == 3
