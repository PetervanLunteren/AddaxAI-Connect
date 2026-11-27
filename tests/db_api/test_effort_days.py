"""
Effort (trap-days) after a correction. A deployment counts to its last photo,
unless a person typed its last day: then it counts to that day. The days are
read with days_sql, the rule every screen uses, so this runs the real SQL.

Every scenario starts from a camera that stood at Home with its last photo
there on day 10, was silent, and was moved on day 20.
"""
from typing import Optional

import pytest

from deployment_db import (
    HOME, at, day, deployments, history, make_camera, make_project, make_site, offset, rows,
)
from routers.deployments import SetDeploymentRequest, not_moved, remove_statement, set_deployment
from shared.effort import days_sql

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)


def effort_days(deployment_id: int) -> int:
    [row] = rows(f"SELECT {days_sql('d')} AS days FROM deployments d WHERE d.id = :i", i=deployment_id)
    return row["days"]


async def edit(session, admin, project, cam, deployment_id: Optional[int], site, first: int, last: Optional[int]):
    return await set_deployment(project, SetDeploymentRequest(
        camera_id=cam, site_id=site, from_date=day(first),
        until_date=day(last) if last else None, deployment_id=deployment_id), session, admin)


@pytest.fixture
def silent_then_moved():
    """Home from day 1, last photo there on day 10, at Far from day 20."""
    project = make_project()
    home = make_site(project, "Home", HOME)
    pond = make_site(project, "Pond", offset(HOME, north_m=5000))
    cam = make_camera("SILENT", project)
    history(cam, [(HOME, at(1)), (HOME, at(10)), (FAR, at(20)), (FAR, at(21))])
    first, _ = deployments(cam)
    return project, cam, home, pond, first


async def test_the_gps_deployment_counts_to_its_last_photo(silent_then_moved):
    *_, first = silent_then_moved
    assert effort_days(first["id"]) == 10


async def test_changing_only_the_site_adds_no_days(session, admin, silent_then_moved):
    """Before, the correction made the end count: 19 days, the 9 silent
    days before the move included."""
    project, cam, home, pond, first = silent_then_moved
    await edit(session, admin, project, cam, first["id"], pond, 1, 19)
    edited, _ = deployments(cam)
    assert (edited["site_id"], edited["site_source"]) == (pond, "manual")
    assert effort_days(edited["id"]) == 10


async def test_it_stayed_counts_to_the_last_photo(session, admin):
    project = make_project()
    make_site(project, "Home", HOME)
    cam = make_camera("TRIP", project)
    history(cam, [(HOME, at(1)), (HOME, at(2)), (FAR, at(10)), (FAR, at(11))])
    _, trip = deployments(cam)
    await not_moved(project, trip["id"], session, admin)
    [one] = deployments(cam)
    assert effort_days(one["id"]) == 11


async def test_a_typed_last_day_counts_in_full_and_undo_takes_it_back(session, admin, silent_then_moved):
    project, cam, home, pond, first = silent_then_moved
    result = await edit(session, admin, project, cam, first["id"], home, 1, 15)
    edited = deployments(cam)[0]
    assert effort_days(edited["id"]) == 15

    await remove_statement(project, result.statement_id, session, admin)
    back = deployments(cam)[0]
    assert effort_days(back["id"]) == 10


async def test_an_added_deployment_with_a_last_day_counts_to_it(session, admin):
    """A camera without GPS, its site set with a last day after its last
    photo. It stays its own deployment, also with the same site after it."""
    project = make_project()
    pond = make_site(project, "Pond", HOME)
    cam = make_camera("NOGPS", project)
    history(cam, [(None, at(2)), (None, at(5)), (None, at(9))])
    await edit(session, admin, project, cam, None, pond, 1, 7)
    await edit(session, admin, project, cam, None, pond, 8, None)
    first, second = deployments(cam)
    assert (first["end_date"], second["start_date"]) == (day(7), day(8))
    assert effort_days(first["id"]) == 7


async def test_a_typed_last_day_cut_short_by_a_newer_correction_is_not_typed(session, admin, silent_then_moved):
    """The person typed day 15, then put the camera at Pond from days 6 to
    15. The part left at Home ends where Pond starts, not on the typed day,
    so it counts to its own last photo: day 1 (the day-10 photo is Pond's)."""
    project, cam, home, pond, first = silent_then_moved
    await edit(session, admin, project, cam, first["id"], home, 1, 15)
    await edit(session, admin, project, cam, None, pond, 6, 15)
    cut = deployments(cam)[0]
    assert (cut["site_id"], cut["end_date"]) == (home, day(5))
    [flag] = rows("SELECT last_day_set FROM deployments WHERE id = :i", i=cut["id"])
    assert flag["last_day_set"] is False
    assert effort_days(cut["id"]) == 1


async def test_the_flag_is_written_only_for_a_typed_last_day(session, admin, silent_then_moved):
    project, cam, home, pond, first = silent_then_moved
    await edit(session, admin, project, cam, first["id"], pond, 1, 19)
    assert [r["last_day_set"] for r in rows(
        "SELECT last_day_set FROM deployments WHERE camera_id = :c ORDER BY start_at", c=cam)] == [False, False]
