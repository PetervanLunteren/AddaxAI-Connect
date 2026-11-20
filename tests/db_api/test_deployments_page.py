"""
Step 3a: what the Camera updates page reads.

The list gives every deployment with its photo days, and the photo days that
have no deployment. The readings of one camera come with the reason each
deployment starts where it does, worked out by the same build the rebuild
runs.
"""
from datetime import datetime

import pytest

from deployment_db import (
    HOME, at, deployments, make_camera, make_image, make_project, make_site,
    make_statement, offset,
)
from routers.deployments import camera_readings, list_deployments

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)


def rebuild(camera_id):
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    with get_db_session() as s:
        rebuild_camera(s, camera_id)


@pytest.fixture
def moved_camera():
    """At Home on days 1 to 3, two photos 2 km away on day 10 and 11."""
    project = make_project()
    cam = make_camera("MOVER", project)
    for day in (1, 2, 3):
        make_image(cam, None, at(day), HOME)
    make_image(cam, None, at(10, hour=9), FAR)
    make_image(cam, None, at(11), offset(FAR, north_m=10))
    rebuild(cam)
    return project, cam


async def test_a_move_says_how_far_how_many_and_when(session, admin, moved_camera):
    project, cam = moved_camera
    home, far = deployments(cam)
    result = await camera_readings(project, cam, session, admin)

    starts = {s.deployment_id: s for s in result.starts}
    assert starts[home["id"]].kind == "first"
    moved = starts[far["id"]]
    assert moved.kind == "moved" and moved.readings == 2
    assert moved.first_at == datetime(2026, 3, 10, 9).isoformat()
    assert 1990 <= moved.distance_m <= 2010
    assert result.threshold_m == 250


async def test_dots_are_grouped_per_deployment_and_spot(session, admin, moved_camera):
    project, cam = moved_camera
    home, far = deployments(cam)
    result = await camera_readings(project, cam, session, admin)
    by_deployment = {}
    for d in result.dots:
        by_deployment[d.deployment_id] = by_deployment.get(d.deployment_id, 0) + d.count
    assert by_deployment == {home["id"]: 3, far["id"]: 2}
    # The three photos at Home share one spot, so one dot with count 3.
    assert sorted(d.count for d in result.dots if d.deployment_id == home["id"]) == [3]


async def test_a_fixed_period_says_fixed(session, admin):
    project = make_project()
    cam = make_camera("FIXED", project)
    pond = make_site(project, "Pond", HOME)
    make_image(cam, None, at(2), HOME)
    make_image(cam, None, at(5), FAR)
    make_image(cam, None, at(6), FAR)
    make_statement(cam, pond, at(1, hour=0), at(8, hour=0))
    rebuild(cam)

    [dep] = deployments(cam)
    result = await camera_readings(project, cam, session, admin)
    assert [(s.deployment_id, s.kind) for s in result.starts] == [(dep["id"], "fixed")]


async def test_parts_joined_at_one_site_keep_the_first_reason(session, admin):
    """A GPS part at Home on days 1 and 2, then a period fixed at Home from
    day 3. The rebuild joins them into one row that starts with the GPS
    part, so the row has the reason of that part."""
    project = make_project()
    cam = make_camera("BACK", project)
    home_site = make_site(project, "Home", HOME)
    make_image(cam, None, at(1), HOME)
    make_image(cam, None, at(2), HOME)
    make_statement(cam, home_site, at(3, hour=0), at(6, hour=0))  # back to back with the GPS part
    make_image(cam, None, at(4), HOME)
    rebuild(cam)

    [row] = deployments(cam)
    result = await camera_readings(project, cam, session, admin)
    assert [(s.deployment_id, s.kind) for s in result.starts] == [(row["id"], "first")]


async def test_the_list_has_photo_days_and_photos_without_a_site(session, admin, moved_camera):
    project, cam = moved_camera
    lost = make_camera("NOGPS", project)
    make_image(lost, None, at(4))
    make_image(lost, None, at(5))
    rebuild(lost)

    overview = await list_deployments(project, session, admin, None)
    home, far = overview.deployments
    assert [(s.start, s.end) for s in home.photo_days] == [("2026-03-01", "2026-03-03")]
    assert [(s.start, s.end) for s in far.photo_days] == [("2026-03-10", "2026-03-11")]
    assert home.start_at < far.start_at and far.end_at is None
    [unplaced] = overview.unplaced
    assert unplaced.camera_id == lost and unplaced.camera_label == "NOGPS"
    assert [(s.start, s.end) for s in unplaced.photo_days] == [("2026-03-04", "2026-03-05")]


async def test_a_viewer_limited_to_sites_sees_no_photos_without_a_site(session, admin, moved_camera):
    project, cam = moved_camera
    lost = make_camera("NOGPS", project)
    make_image(lost, None, at(4))
    rebuild(lost)
    home_site = deployments(cam)[0]["site_id"]

    overview = await list_deployments(project, session, admin, [home_site])
    assert [d.site_id for d in overview.deployments] == [home_site]
    assert overview.unplaced == []
