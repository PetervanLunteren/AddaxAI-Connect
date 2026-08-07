"""Tests for the validated-by filter (validators endpoint and list filter)."""
import os
import sys

import pytest
from sqlalchemy.dialects import postgresql

# Add API service to path so we can import the router directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


class _FakeResult:
    def all(self):
        return []


class _CompileAssertingSession:
    """AsyncSession stand-in whose execute() compiles the query against the
    postgres dialect, so JOIN and column bugs surface without a live DB.
    Mirrors tests/api/test_activity_overlap.py."""

    def __init__(self) -> None:
        self.compiled_queries: list[str] = []

    async def execute(self, query, params=None):
        compiled = query.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": False},
        )
        self.compiled_queries.append(str(compiled))
        return _FakeResult()


class TestGetValidators:
    @pytest.mark.asyncio
    async def test_query_compiles_and_filters_correctly(self):
        from routers.images import get_validators

        db = _CompileAssertingSession()
        out = await get_validators(
            project_id=None,
            accessible_project_ids=[1, 2],
            db=db,
            current_user=None,
        )

        assert out == []
        assert len(db.compiled_queries) == 1
        compiled = db.compiled_queries[0]
        # Joined through the verifying user, not any other user reference
        assert "verified_by_user_id" in compiled
        # Un-verifying keeps verified_by_user_id for audit, so the endpoint
        # must exclude those rows or ghost validators appear in the dropdown
        assert "is_verified" in compiled
        # Hidden images must not make someone a validator
        assert "is_hidden" in compiled
        # Scoped to the caller's projects
        assert "project_id" in compiled
        assert "DISTINCT" in compiled

    @pytest.mark.asyncio
    async def test_project_narrowing_rejects_foreign_project(self):
        from fastapi import HTTPException
        from routers.images import get_validators

        with pytest.raises(HTTPException) as exc:
            await get_validators(
                project_id=99,
                accessible_project_ids=[1, 2],
                db=_CompileAssertingSession(),
                current_user=None,
            )
        assert exc.value.status_code == 403


class TestValidatedByParsing:
    """The list endpoint turns the comma-separated validated_by parameter
    into an is_verified + verified_by_user_id filter. Guard the parsing the
    same way the endpoint does it."""

    def _parse(self, validated_by: str) -> list[int]:
        return [int(v.strip()) for v in validated_by.split(',') if v.strip()]

    def test_single_and_multiple_ids(self):
        assert self._parse("7") == [7]
        assert self._parse("3,4, 5") == [3, 4, 5]

    def test_empty_segments_are_dropped(self):
        assert self._parse("3,,4,") == [3, 4]

    def test_non_numeric_crashes_early(self):
        # Crash early and loudly: a malformed id must raise, not silently
        # filter nothing
        with pytest.raises(ValueError):
            self._parse("3,abc")
