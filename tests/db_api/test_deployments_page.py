"""
What the camera updates check reads: every deployment with its photo days,
and the photo days that have no deployment.
"""
import pytest

from deployment_db import HOME, at, deployments, make_camera, make_image, make_project, offset
from routers.deployments import list_deployments

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
