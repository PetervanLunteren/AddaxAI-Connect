"""Removing a deleted or merged site from every stored site_ids list.

The four JSON site_ids columns (detection rules, theft watch rules, viewer
memberships, unused invitations) have no foreign key, so before this cleanup
a deleted site's id stayed behind and a rule scoped only to that site
silently matched nothing forever.

The rules the cleanup must hold:
- delete removes the id, merge replaces it with the target id, deduplicated
- a rule whose list empties keeps [] and is paused (is_active False), so the
  rules page shows what happened
- a membership or invitation whose list empties keeps [], which every scope
  reader treats as "sees nothing" (fail closed)
- rows that never referenced the site are untouched

Run against real model instances, so a dropped column fails here instead of
on a production server (same rationale as test_cleanup_empty_deployments).
"""
from __future__ import annotations

import os
import sys

import pytest

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import (  # noqa: E402
    DetectionAlertRule,
    ProjectMembership,
    TheftWatchRule,
    UserInvitation,
)
from routers.sites import _remove_site_from_scopes, _updated_scope  # noqa: E402


def test_updated_scope_removes():
    assert _updated_scope([5, 7], 5, None) == [7]


def test_updated_scope_replaces_and_dedupes():
    assert _updated_scope([5, 7], 5, 7) == [7]
    assert _updated_scope([5, 8], 5, 7) == [7, 8]


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return list(self._rows)


class _FakeSession:
    """One queued row list per model, in the helper's iteration order."""

    def __init__(self, results):
        self._results = list(results)

    async def execute(self, query):
        return self._results.pop(0)


def _db(detection=(), theft=(), memberships=(), invitations=()):
    return _FakeSession([
        _FakeResult(detection),
        _FakeResult(theft),
        _FakeResult(memberships),
        _FakeResult(invitations),
    ])


@pytest.mark.asyncio
async def test_delete_removes_id_and_keeps_rule_active():
    rule = DetectionAlertRule(id=1, project_id=1, site_ids=[5, 7], is_active=True)
    db = _db(detection=[rule])

    await _remove_site_from_scopes(db, 1, 5)

    assert rule.site_ids == [7]
    assert rule.is_active is True


@pytest.mark.asyncio
async def test_emptied_rule_is_paused():
    detection = DetectionAlertRule(id=1, project_id=1, site_ids=[5], is_active=True)
    theft = TheftWatchRule(id=2, project_id=1, site_ids=[5], is_active=True)
    db = _db(detection=[detection], theft=[theft])

    await _remove_site_from_scopes(db, 1, 5)

    assert detection.site_ids == [] and detection.is_active is False
    assert theft.site_ids == [] and theft.is_active is False


@pytest.mark.asyncio
async def test_merge_replaces_with_target_and_dedupes():
    rule = DetectionAlertRule(id=1, project_id=1, site_ids=[5, 7], is_active=True)
    db = _db(detection=[rule])

    await _remove_site_from_scopes(db, 1, 5, replacement_id=7)

    assert rule.site_ids == [7]
    assert rule.is_active is True


@pytest.mark.asyncio
async def test_emptied_membership_and_invitation_stay_fail_closed():
    membership = ProjectMembership(id=1, project_id=1, user_id=2, role="project-viewer", site_ids=[5])
    invitation = UserInvitation(id=1, project_id=1, email="x@y.z", role="project-viewer", site_ids=[5], used=False)
    db = _db(memberships=[membership], invitations=[invitation])

    await _remove_site_from_scopes(db, 1, 5)

    # [] means "sees nothing", never "all sites"; no is_active flag to touch.
    assert membership.site_ids == []
    assert invitation.site_ids == []


@pytest.mark.asyncio
async def test_rows_without_the_site_are_untouched():
    rule = DetectionAlertRule(id=1, project_id=1, site_ids=[8], is_active=True)
    db = _db(detection=[rule])

    await _remove_site_from_scopes(db, 1, 5)

    assert rule.site_ids == [8]
    assert rule.is_active is True
