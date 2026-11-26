"""
Step 2b: a camera without GPS, placed by hand, and the list of fixed periods.

Photos arrive without GPS and have no site until a person sets a deployment.
Later photos follow. A second period moves the camera. Removing a period gives
back what was underneath.
"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from deployment_db import (
    DAY, HOME, at, deployments, image_deployment, make_camera, make_image,
    make_project, make_site, offset, rows,
)
from routers.deployments import (
    SetDeploymentRequest, list_statements, remove_statement, set_deployment,
)

pytestmark = pytest.mark.asyncio


def day(n: int) -> date:
    return DAY + timedelta(days=n - 1)


def photo(camera_id, taken):
    """A photo without GPS, stored and rebuilt as live ingestion does it."""
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    image = make_image(camera_id, None, taken)
    with get_db_session() as s:
        rebuild_camera(s, camera_id)
    return image


@pytest.fixture
def setup():
    project = make_project()
    cam = make_camera("REOLINK01", project)
    pond = make_site(project, "Pond", HOME)
    meadow = make_site(project, "Meadow", offset(HOME, east_m=900))
    return project, cam, pond, meadow


async def place(session, admin, project, cam, site, first, last=None):
    return await set_deployment(
        project,
        SetDeploymentRequest(camera_id=cam, site_id=site, from_date=day(first),
                             until_date=day(last) if last else None),
        session, admin,
    )


async def test_photos_without_gps_wait_for_a_place(session, admin, setup):
    project, cam, pond, meadow = setup
    early = [photo(cam, at(2)), photo(cam, at(3))]
    assert deployments(cam) == []
    assert [image_deployment(u) for u in early] == [None, None]

    await place(session, admin, project, cam, pond, 1)

    [dep] = deployments(cam)
    assert dep["site_id"] == pond and dep["end_date"] is None
    assert dep["start_date"] == day(1)
    assert [image_deployment(u) for u in early] == [dep["id"], dep["id"]]


async def test_later_photos_follow_the_open_period(session, admin, setup):
    project, cam, pond, meadow = setup
    photo(cam, at(2))
    await place(session, admin, project, cam, pond, 1)
    later = photo(cam, at(20))

    [dep] = deployments(cam)
    assert image_deployment(later) == dep["id"]


async def test_a_second_period_moves_the_camera(session, admin, setup):
    project, cam, pond, meadow = setup
    first = photo(cam, at(2))
    await place(session, admin, project, cam, pond, 1)
    second = photo(cam, at(12))
    await place(session, admin, project, cam, meadow, 10)

    at_pond, at_meadow = deployments(cam)
    assert (at_pond["site_id"], at_pond["end_date"]) == (pond, day(9))
    assert (at_meadow["site_id"], at_meadow["start_date"], at_meadow["end_date"]) == (meadow, day(10), None)
    assert image_deployment(first) == at_pond["id"]
    assert image_deployment(second) == at_meadow["id"]


async def test_removing_a_period_gives_back_what_was_underneath(session, admin, setup):
    project, cam, pond, meadow = setup
    photo(cam, at(2))
    second = photo(cam, at(12))
    await place(session, admin, project, cam, pond, 1)
    await place(session, admin, project, cam, meadow, 10)

    newest = (await list_statements(project, cam, session, admin))[0]
    assert newest.site_name == "Meadow"
    await remove_statement(project, newest.id, session, admin)

    [dep] = deployments(cam)
    assert dep["site_id"] == pond and dep["end_date"] is None
    assert image_deployment(second) == dep["id"]
    [removed] = rows("SELECT removed_at, removed_by_user_id FROM deployment_statements WHERE id = :i", i=newest.id)
    assert removed["removed_at"] is not None and removed["removed_by_user_id"] == admin.id


async def test_removing_the_only_period_leaves_the_photos_without_site(session, admin, setup):
    project, cam, pond, meadow = setup
    early = photo(cam, at(2))
    await place(session, admin, project, cam, pond, 1)
    [statement] = await list_statements(project, cam, session, admin)

    await remove_statement(project, statement.id, session, admin)

    assert deployments(cam) == []
    assert image_deployment(early) is None
    assert await list_statements(project, cam, session, admin) == []


async def test_the_list_says_who_and_which_days(session, admin, setup):
    project, cam, pond, meadow = setup
    await place(session, admin, project, cam, pond, 1, 5)

    [item] = await list_statements(project, cam, session, admin)
    assert (item.site_name, item.from_date, item.until_date) == ("Pond", "2026-03-01", "2026-03-05")
    assert item.source == "person" and item.created_by == "admin@example.org"
    # A site set by hand answered no move.
    assert item.answers_move_at is None


async def test_a_closed_period_is_exactly_its_days(session, admin, setup):
    project, cam, pond, meadow = setup
    inside = photo(cam, at(3))
    after = photo(cam, at(8))
    await place(session, admin, project, cam, pond, 1, 5)

    [dep] = deployments(cam)
    assert (dep["start_date"], dep["end_date"]) == (day(1), day(5))
    assert image_deployment(inside) == dep["id"]
    assert image_deployment(after) is None


async def test_removing_twice_is_not_found(session, admin, setup):
    project, cam, pond, meadow = setup
    await place(session, admin, project, cam, pond, 1)
    [statement] = await list_statements(project, cam, session, admin)
    await remove_statement(project, statement.id, session, admin)
    with pytest.raises(HTTPException) as err:
        await remove_statement(project, statement.id, session, admin)
    assert err.value.status_code == 404


async def test_a_site_of_another_project_is_not_found(session, admin, setup):
    project, cam, pond, meadow = setup
    elsewhere = make_site(make_project("Other"), "Elsewhere", HOME)
    with pytest.raises(HTTPException) as err:
        await place(session, admin, project, cam, elsewhere, 1)
    assert err.value.status_code == 404


async def test_without_a_camera_the_list_is_the_whole_project(session, admin, setup):
    """The Moves page lists every correction of the
    project, with the camera it belongs to."""
    project, cam, pond, meadow = setup
    other = make_camera("REOLINK02", project)
    other_project = make_project("Other")
    elsewhere = make_camera("ELSEWHERE", other_project)
    await place(session, admin, project, cam, pond, 1)
    await place(session, admin, project, other, meadow, 2)
    await place(session, admin, other_project, elsewhere, make_site(other_project, "Far", HOME), 1)
    await place(session, admin, project, cam, meadow, 10)

    items = await list_statements(project, None, session, admin)
    assert [(i.camera_label, i.site_name) for i in items] == [
        ("REOLINK01", "Meadow"), ("REOLINK02", "Meadow"), ("REOLINK01", "Pond"),
    ]


async def test_a_period_of_another_project_is_not_removed(session, admin, setup):
    project, cam, pond, meadow = setup
    other_project = make_project("Other")
    elsewhere = make_camera("ELSEWHERE", other_project)
    await place(session, admin, project, cam, pond, 1)
    theirs = await place(session, admin, other_project, elsewhere, make_site(other_project, "Far", HOME), 1)

    with pytest.raises(HTTPException) as err:
        await remove_statement(project, theirs.statement_id, session, admin)
    assert err.value.status_code == 404
    assert len(await list_statements(project, None, session, admin)) == 1
