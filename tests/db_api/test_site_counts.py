"""
"Cameras" on a site means the cameras there now, as on the Cameras page
and the site's Cameras tab. A camera that left still counts in the site's
deployments, and shows in its History tab.
"""
import pytest

from deployment_db import HOME, at, make_camera, make_deployment, make_project, make_site, offset
from routers.sites import _build_detail, list_sites

pytestmark = pytest.mark.asyncio


async def test_a_camera_that_left_no_longer_counts_as_at_the_site(session, admin):
    project = make_project()
    pond = make_site(project, "Pond", HOME)
    ridge = make_site(project, "Ridge", offset(HOME, north_m=1500))
    stays = make_camera("S01", project)
    left = make_camera("S02", project)
    make_deployment(stays, 1, pond, at(1).date(), None, HOME)
    make_deployment(left, 1, pond, at(1).date(), at(30).date(), HOME)
    make_deployment(left, 2, ridge, at(31).date(), None, offset(HOME, north_m=1500))

    listed = {s.name: s for s in await list_sites(project, admin, None, session)}
    assert (listed["Pond"].camera_count, listed["Pond"].deployment_count) == (1, 2)
    assert (listed["Ridge"].camera_count, listed["Ridge"].deployment_count) == (1, 1)
    detail = await _build_detail(session, project, pond)
    assert (detail.camera_count, detail.deployment_count) == (1, 2)
