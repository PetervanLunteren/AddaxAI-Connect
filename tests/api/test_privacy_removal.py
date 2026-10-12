"""Privacy removal on the API side: the project flags and the blur gate."""
import inspect
import os
import sys
from types import SimpleNamespace

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Project


class TestDeleteCategories:
    def _project(self, people: bool, vehicles: bool) -> Project:
        return Project(name="p", delete_people=people, delete_vehicles=vehicles)

    def test_both_on(self):
        assert self._project(True, True).delete_categories() == ["person", "vehicle"]

    def test_people_only(self):
        assert self._project(True, False).delete_categories() == ["person"]

    def test_vehicles_only(self):
        assert self._project(False, True).delete_categories() == ["vehicle"]

    def test_both_off(self):
        assert self._project(False, False).delete_categories() == []


class TestProjectApi:
    def test_update_turns_blur_on_when_delete_is_turned_on(self):
        # Photos stored before the switch stay and must at least be blurred,
        # so the stored pair never says delete without blur.
        from routers.projects import update_project

        src = inspect.getsource(update_project)
        assert "if project_data.delete_people:" in src
        assert "project.blur_people = True" in src
        assert "if project_data.delete_vehicles:" in src
        assert "project.blur_vehicles = True" in src

    def test_request_and_response_carry_the_flags(self):
        from routers.projects import ProjectResponse, ProjectUpdate

        for model in (ProjectUpdate, ProjectResponse):
            assert "delete_people" in model.model_fields
            assert "delete_vehicles" in model.model_fields

    def test_user_project_list_carries_the_flags(self):
        # This list is what the frontend reads as the selected project.
        from routers.users import ProjectWithRole

        assert "delete_people" in ProjectWithRole.model_fields
        assert "delete_vehicles" in ProjectWithRole.model_fields


class TestBlurGate:
    def test_blur_query_skips_removed_photos(self):
        # A placeholder keeps its person/vehicle detections. Blurring those
        # boxes would only smear the sentence drawn on it.
        from routers.images import blur_regions_for_images

        assert "Image.privacy_removed_at.is_(None)" in inspect.getsource(blur_regions_for_images)


class TestCurationDelete:
    """The curation delete dialog's "photos only" choice and the full delete."""

    def test_request_carries_the_flag_off_by_default(self):
        from routers.image_admin import BulkImageActionRequest

        assert BulkImageActionRequest.model_fields["keep_records"].default is False

    def test_photos_only_goes_through_the_shared_helper_and_keeps_rows(self):
        from routers.image_admin import replace_images_by_ids

        src = inspect.getsource(replace_images_by_ids)
        assert "replace_with_placeholder(" in src
        assert "shown_categories(" in src
        assert src.index("replace_with_placeholder(") < src.index("privacy_removed_at = now")
        for forbidden in ("db.delete(", "sql_delete(", "cleanup_empty_deployments("):
            assert forbidden not in src

    def test_endpoint_skips_rows_replaced_before(self):
        # Otherwise a filters target keeps matching the same rows and the
        # UI loop never ends.
        from routers.image_admin import bulk_delete_images

        src = inspect.getsource(bulk_delete_images)
        assert "Image.privacy_removed_at.is_(None)" in src
        assert "replace_images_by_ids(" in src
        assert "delete_images_by_ids(" in src

    def test_full_delete_removes_every_raw_version(self):
        from routers.image_admin import delete_images_by_ids

        src = inspect.getsource(delete_images_by_ids)
        assert "delete_object_versions(BUCKET_RAW_IMAGES" in src

    def test_replaced_photos_get_a_fresh_url_so_the_browser_cache_misses(self):
        # Thumbnails are cached an hour and full images a day. Without a
        # changed URL the admin who just removed photos keeps seeing them.
        from routers import image_admin, images

        assert images.removed_suffix(SimpleNamespace(privacy_removed_at=None)) == ""
        assert images.removed_suffix(SimpleNamespace(privacy_removed_at="2026-10-12")) == "?v=removed"
        assert "/thumbnail{removed_suffix(image)}" in inspect.getsource(images.list_images)
        assert "/full{removed_suffix(image)}" in inspect.getsource(images.get_image)
        assert "/thumbnail{removed_suffix(image)}" in inspect.getsource(image_admin.list_all_images)

    def test_curation_species_filter_matches_person_and_vehicle(self):
        # person and vehicle are detector categories with no classification
        # row; the dropdown offers them, so the filter must find them.
        from routers.image_admin import _build_filter_clauses

        assert "Detection.category.in_(species_list)" in inspect.getsource(_build_filter_clauses)
