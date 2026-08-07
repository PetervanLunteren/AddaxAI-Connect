"""Tests for the independent people/vehicles privacy blur."""
import inspect
import os
import sys

# Add API service and repo root to path so modules import directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
_repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Project


class TestBlurCategories:
    def _project(self, people: bool, vehicles: bool) -> Project:
        return Project(name="p", blur_people=people, blur_vehicles=vehicles)

    def test_both_on(self):
        assert self._project(True, True).blur_categories() == ["person", "vehicle"]

    def test_people_only(self):
        assert self._project(True, False).blur_categories() == ["person"]

    def test_vehicles_only(self):
        assert self._project(False, True).blur_categories() == ["vehicle"]

    def test_both_off(self):
        assert self._project(False, False).blur_categories() == []


class TestConsumersUseTheHelper:
    """Every blur consumer must go through Project.blur_categories() so the
    category choice has a single source of truth. A consumer hardcoding the
    old combined flag or the category pair silently breaks independence."""

    def test_model_has_no_combined_flag(self):
        assert not hasattr(Project, "blur_people_vehicles")

    def test_serve_path_uses_the_helper(self):
        from routers.images import _get_blur_regions

        src = inspect.getsource(_get_blur_regions)
        assert "blur_categories()" in src
        assert "blur_people_vehicles" not in src
        assert '"person", "vehicle"' not in src

    def test_export_uses_the_helper(self):
        from routers import export

        src = inspect.getsource(export)
        assert "blur_categories()" in src
        assert "blur_people_vehicles" not in src

    def test_both_workers_use_the_helper(self):
        # The worker services are not importable packages (dashes in the
        # directory names), so check their source text directly
        for service in ("classification-deepfaune", "classification-speciesnet"):
            path = os.path.join(_repo, "services", service, "worker.py")
            src = open(path).read()
            assert "blur_categories()" in src, service
            assert "blur_people_vehicles" not in src, service
            # The blur query must filter on the configured categories, and
            # the notification trigger must keep firing for both categories
            # regardless of blur settings
            assert "DetectionModel.category.in_(blur_cats)" in src, service
            assert "d.category in ('person', 'vehicle')" in src, service
