"""Privacy removal on the API side: the project flags and the blur gate."""
import inspect
import os
import sys

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
