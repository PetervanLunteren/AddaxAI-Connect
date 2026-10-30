"""Tests for self-service project creation (any project admin may create)."""
import inspect
import os
import sys

import pytest
from fastapi import HTTPException

# Add API service to path so we can import the modules directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


class FakeUser:
    def __init__(self, is_superuser=False, user_id=7):
        self.is_superuser = is_superuser
        self.id = user_id


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDb:
    """Returns one membership id (or None) for the admin-membership query."""

    def __init__(self, membership_id):
        self._membership_id = membership_id
        self.queries = 0

    async def execute(self, query):
        self.queries += 1
        return FakeResult(self._membership_id)


class TestRequireAnyProjectAdmin:
    async def _call(self, user, db):
        from auth.permissions import require_any_project_admin

        return await require_any_project_admin(user=user, db=db)

    @pytest.mark.asyncio
    async def test_server_admin_passes_without_a_query(self):
        db = FakeDb(membership_id=None)
        user = FakeUser(is_superuser=True)
        assert await self._call(user, db) is user
        assert db.queries == 0

    @pytest.mark.asyncio
    async def test_project_admin_somewhere_passes(self):
        db = FakeDb(membership_id=42)
        user = FakeUser()
        assert await self._call(user, db) is user
        assert db.queries == 1

    @pytest.mark.asyncio
    async def test_user_without_admin_membership_gets_403(self):
        # Covers viewers and users with no memberships alike: the query
        # filters on role == project-admin, so both come back empty.
        db = FakeDb(membership_id=None)
        with pytest.raises(HTTPException) as exc:
            await self._call(FakeUser(), db)
        assert exc.value.status_code == 403


class TestCreateProjectSource:
    """Source-level guards, same convention as test_map_metrics.py."""

    def _source(self):
        from routers import projects

        return inspect.getsource(projects.create_project)

    def test_creator_membership_is_written_for_non_server_admins(self):
        src = self._source()
        assert "if not current_user.is_superuser" in src
        assert "ProjectMembership(" in src
        assert "Role.PROJECT_ADMIN.value" in src

    def test_membership_shares_the_commit_with_the_project(self):
        # One transaction: a crash between project and membership must not
        # leave an orphan project the creator cannot reach.
        src = self._source()
        assert src.count("await db.commit()") == 1
        assert src.index("db.flush()") < src.index("ProjectMembership(")

    def test_delete_stays_server_admin(self):
        from routers import projects

        sig = inspect.signature(projects.delete_project)
        assert "require_server_admin" in str(
            sig.parameters["current_user"].default
        )


class TestProjectName:
    def test_blank_name_is_refused(self):
        from pydantic import ValidationError

        from routers.projects import ProjectCreate, ProjectUpdate

        # The country is valid, so the name is what fails.
        with pytest.raises(ValidationError):
            ProjectCreate(classification_model="EUR-DF-v1-4", name="   ", country_code="NLD")
        with pytest.raises(ValidationError):
            ProjectUpdate(name="   ")

    def test_name_with_spaces_inside_is_fine(self):
        from routers.projects import ProjectCreate, ProjectUpdate

        assert ProjectCreate(classification_model="EUR-DF-v1-4", name="Mont de Grange", country_code="NLD").name == "Mont de Grange"
        assert ProjectUpdate(name=" x").name == " x"
        assert ProjectUpdate().name is None


class TestProjectCountry:
    def test_country_is_required_on_create(self):
        from pydantic import ValidationError

        from routers.projects import ProjectCreate

        with pytest.raises(ValidationError):
            ProjectCreate(classification_model="EUR-DF-v1-4", name="Park")

    def test_country_is_normalised(self):
        from routers.projects import ProjectCreate, ProjectUpdate

        assert ProjectCreate(classification_model="EUR-DF-v1-4", name="Park", country_code=" nld ").country_code == "NLD"
        assert ProjectUpdate(country_code="ken").country_code == "KEN"
        assert ProjectUpdate().country_code is None

    @pytest.mark.parametrize("code", ["NL", "NLDX", "N1D", ""])
    def test_bad_country_is_refused(self, code):
        from pydantic import ValidationError

        from routers.projects import ProjectCreate, ProjectUpdate

        with pytest.raises(ValidationError):
            ProjectCreate(classification_model="EUR-DF-v1-4", name="Park", country_code=code)
        with pytest.raises(ValidationError):
            ProjectUpdate(country_code=code)

    def test_state_only_with_usa(self):
        from pydantic import ValidationError

        from routers.projects import ProjectCreate

        project = ProjectCreate(classification_model="EUR-DF-v1-4", name="Park", country_code="usa", admin1_region="us-ca")
        assert project.admin1_region == "US-CA"
        with pytest.raises(ValidationError):
            ProjectCreate(classification_model="EUR-DF-v1-4", name="Park", country_code="NLD", admin1_region="US-CA")

    def test_empty_state_on_create_means_none(self):
        from routers.projects import ProjectCreate

        assert ProjectCreate(classification_model="EUR-DF-v1-4", name="Park", country_code="USA", admin1_region="").admin1_region is None

    @pytest.mark.parametrize("region", ["CA", "US-C", "US-CAL", "CA-ON"])
    def test_bad_state_is_refused(self, region):
        from pydantic import ValidationError

        from routers.projects import ProjectUpdate

        with pytest.raises(ValidationError):
            ProjectUpdate(admin1_region=region)

    def test_empty_state_on_update_means_clear(self):
        from routers.projects import ProjectUpdate

        # Empty string is the "clear the state" signal, None is "not sent".
        assert ProjectUpdate(admin1_region="").admin1_region == ""
        assert ProjectUpdate().admin1_region is None

    def test_state_check_against_the_stored_country(self):
        from routers.projects import check_admin1_with_country

        check_admin1_with_country("USA", "US-CA")
        check_admin1_with_country("NLD", None)
        with pytest.raises(ValueError):
            check_admin1_with_country("NLD", "US-CA")
        with pytest.raises(ValueError):
            check_admin1_with_country(None, "US-CA")
