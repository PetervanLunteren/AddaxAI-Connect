"""
Suspicious deployments: a deployment the GPS made that came back to the site
it left within a week, and that nobody answered. One SQL condition decides
it (SHORT_TRIP_SQL in shared/deployment_queries.py). The To do line counts
with it and the deployments list carries it per row, so the Needs attention
count and the Suspicious marks on the Deployments page cannot differ.
"""
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from deployment_db import (
    HOME, at, deployments, history, make_camera, make_project, make_site, offset, rows,
)
from routers.deployments import CheckedRequest, list_deployments, set_checked, set_deployment, SetDeploymentRequest
from utils.todo import SUSPICIOUS_MOVES_SQL

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)
ELSEWHERE = offset(HOME, north_m=4000)


async def counted(project, session) -> int:
    """How many suspicious deployments the To do line counts."""
    result = await session.execute(text(SUSPICIOUS_MOVES_SQL), {"project_ids": [project]})
    return len(result.all())


async def marked(project, session, admin) -> list[int]:
    """The deployments the Deployments page marks Suspicious."""
    listed = await list_deployments(project, session, admin, None)
    return [d.id for d in listed if d.short_trip and d.checked_at is None]


def trip(days_away: float, back_at=HOME):
    """A camera at Home, then `days_away` days at Far, then at `back_at`.
    Returns the project and the three deployments. Two photos confirm each
    move, a second apart."""
    project = make_project()
    make_site(project, "Home", HOME)
    cam = make_camera("TRIP", project)
    out, back = at(10), at(10) + timedelta(days=days_away)
    second = timedelta(seconds=1)
    history(cam, [(HOME, at(1)), (HOME, at(2)), (FAR, out), (FAR, out + second),
                  (back_at, back), (back_at, back + second)])
    return project, deployments(cam)


async def test_a_trip_that_came_back_within_a_week_is_suspicious(session, admin):
    project, (first, away, back) = trip(days_away=1)
    assert first["site_id"] == back["site_id"] != away["site_id"]

    # Only the trip out, not the start and not the way back.
    assert await marked(project, session, admin) == [away["id"]]
    assert await counted(project, session) == 1


@pytest.mark.parametrize("days_away, back_at, why", [
    (7 + 1 / 24, HOME, "an hour longer than a week"),
    (30, HOME, "a month away is a real redeployment"),
    (1, ELSEWHERE, "it went on to a third place, it did not come back"),
])
async def test_other_moves_are_not_suspicious(session, admin, days_away, back_at, why):
    project, _ = trip(days_away, back_at)
    assert await marked(project, session, admin) == [], why
    assert await counted(project, session) == 0, why


async def test_exactly_a_week_still_is(session, admin):
    project, (_, away, _) = trip(days_away=7)
    assert await marked(project, session, admin) == [away["id"]]
    assert await counted(project, session) == 1


async def test_a_trip_a_person_set_is_not_suspicious(session, admin):
    """Only the GPS makes a suspicious deployment. Changing the site of the
    trip is a person's word about it."""
    project, (_, away, _) = trip(days_away=1)
    pond = make_site(project, "Pond", ELSEWHERE)
    [cam] = rows("SELECT camera_id, start_date, end_date FROM deployments WHERE id = :d", d=away["id"])
    await set_deployment(project, SetDeploymentRequest(
        camera_id=cam["camera_id"], site_id=pond, from_date=cam["start_date"], until_date=cam["end_date"],
        deployment_id=away["id"]), session, admin)
    assert await marked(project, session, admin) == []
    assert await counted(project, session) == 0


async def test_right_clears_it_and_undo_asks_again(session, admin):
    project, (_, away, _) = trip(days_away=1)

    await set_checked(project, away["id"], CheckedRequest(checked=True), session, admin)
    assert await marked(project, session, admin) == []
    assert await counted(project, session) == 0
    [row] = rows("SELECT checked_at, checked_by_user_id FROM deployments WHERE id = :d", d=away["id"])
    assert row["checked_at"] is not None and row["checked_by_user_id"] == admin.id

    await set_checked(project, away["id"], CheckedRequest(checked=False), session, admin)
    assert await marked(project, session, admin) == [away["id"]]
    assert await counted(project, session) == 1
    [row] = rows("SELECT checked_at, checked_by_user_id FROM deployments WHERE id = :d", d=away["id"])
    assert row["checked_at"] is None and row["checked_by_user_id"] is None


async def test_right_stays_through_a_rebuild(session, admin):
    project, (_, away, back) = trip(days_away=1)
    await set_checked(project, away["id"], CheckedRequest(checked=True), session, admin)
    [cam] = rows("SELECT camera_id FROM deployments WHERE id = :d", d=away["id"])
    history(cam["camera_id"], [(HOME, at(20))])
    assert await counted(project, session) == 0


async def test_a_deployment_of_another_project_is_not_found(session, admin):
    project, (_, away, _) = trip(days_away=1)
    other = make_project("Other")
    with pytest.raises(HTTPException) as err:
        await set_checked(other, away["id"], CheckedRequest(checked=True), session, admin)
    assert err.value.status_code == 404
    assert await counted(project, session) == 1
