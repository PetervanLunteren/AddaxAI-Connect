"""
What the Moves page reads: every deployment of the project.
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


async def test_the_list_has_every_deployment_oldest_first(session, admin, moved_camera):
    project, cam = moved_camera
    home, far = await list_deployments(project, session, admin, None)
    assert home.start_at < far.start_at and far.end_at is None
    assert (home.camera_label, home.image_count, far.image_count) == ("MOVER", 3, 2)
    assert home.site_source == far.site_source == "auto"


async def test_a_viewer_limited_to_sites_sees_only_those(session, admin, moved_camera):
    project, cam = moved_camera
    home_site = deployments(cam)[0]["site_id"]
    listed = await list_deployments(project, session, admin, [home_site])
    assert [d.site_id for d in listed] == [home_site]
