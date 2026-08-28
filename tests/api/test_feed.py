"""Tests for the camera updates feed helpers."""
from __future__ import annotations

import os
import sys

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.feed import nearby_sites  # noqa: E402


# ~0.001 deg latitude is ~111 m; useful spacing for threshold tests.
DEP_LAT, DEP_LON = 52.0, 5.0

SITES = [
    {"id": 1, "name": "far away", "lat": 52.1, "lon": 5.0},        # ~11 km
    {"id": 2, "name": "second nearest", "lat": 52.0015, "lon": 5.0},  # ~167 m
    {"id": 3, "name": "nearest", "lat": 52.0005, "lon": 5.0},      # ~56 m
    {"id": 4, "name": "just outside", "lat": 52.003, "lon": 5.0},  # ~334 m
]


def test_only_sites_within_threshold():
    result = nearby_sites(DEP_LAT, DEP_LON, SITES)
    assert [s["site_id"] for s in result] == [3, 2]


def test_sorted_nearest_first():
    result = nearby_sites(DEP_LAT, DEP_LON, SITES)
    distances = [s["distance_m"] for s in result]
    assert distances == sorted(distances)
    assert result[0]["name"] == "nearest"


def test_distance_is_rounded_metres():
    result = nearby_sites(DEP_LAT, DEP_LON, SITES)
    assert result[0]["distance_m"] == round(result[0]["distance_m"], 1)
    assert 50 < result[0]["distance_m"] < 60


def test_no_sites():
    assert nearby_sites(DEP_LAT, DEP_LON, []) == []


def test_site_at_exact_location_included():
    result = nearby_sites(DEP_LAT, DEP_LON, [
        {"id": 9, "name": "same spot", "lat": DEP_LAT, "lon": DEP_LON},
    ])
    assert result == [{"site_id": 9, "name": "same spot", "distance_m": 0.0}]


# --- resolve request validation ---------------------------------------------
# The resolve endpoint needs a database, so the pure parts are tested here:
# which actions the request accepts, and the name rule the naming actions
# share.
from fastapi import HTTPException  # noqa: E402
import pytest  # noqa: E402
from pydantic import ValidationError  # noqa: E402

from routers.feed import (  # noqa: E402
    ResolveFeedEventRequest,
    _required_name,
    _scope_clause,
)


@pytest.mark.parametrize("action", ["rename_site", "set_site", "new_site", "not_moved", "confirmed"])
def test_resolve_accepts_every_action(action):
    assert ResolveFeedEventRequest(action=action).action == action


def test_resolve_rejects_unknown_action():
    with pytest.raises(ValidationError):
        ResolveFeedEventRequest(action="dismiss")


def test_confirmed_takes_no_extra_fields():
    req = ResolveFeedEventRequest(action="confirmed")
    assert req.name is None and req.site_id is None


def test_required_name_strips_and_rejects_blank():
    assert _required_name(ResolveFeedEventRequest(action="new_site", name="  bridge north ")) == "bridge north"
    with pytest.raises(HTTPException) as exc:
        _required_name(ResolveFeedEventRequest(action="rename_site", name="   "))
    assert exc.value.status_code == 422


def test_scope_clause_unrestricted_adds_nothing():
    assert _scope_clause(None) == []


def test_scope_clause_restricts_both_ends_of_a_move():
    clauses = _scope_clause([1, 2])
    sql = " ".join(str(c) for c in clauses)
    assert len(clauses) == 2
    assert "feed_events.site_id IN" in sql
    assert "feed_events.from_site_id IS NULL" in sql
