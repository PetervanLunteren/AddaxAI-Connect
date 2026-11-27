"""
Photos without a site: a camera without GPS has photos with no deployment
until a person sets its site. They count wherever no place is needed and
are left out where one is; the Images list can show them on their own
with the site filter "none", and the trend chart, which divides by trap
effort, leaves them out.

image_site_filter decides the site part of the Images list. A viewer with
a site list never sees these photos, so "none" gives them nothing, and
never their whole list.
"""
import pytest
from sqlalchemy import select

from deployment_db import (
    HOME, at, make_camera, make_deployment, make_image, make_observation, make_project, make_site, scalar,
)
from shared.independence_filter import get_independent_daily_trend
from shared.models import Image
from utils.preferred_counts import get_preferred_daily_trend
from utils.site_scope import image_site_filter

pytestmark = pytest.mark.asyncio


@pytest.fixture
def photos():
    """One photo at site A, one at site B, one without a site."""
    project = make_project()
    a = make_site(project, "A", HOME)
    b = make_site(project, "B", HOME)
    cam = make_camera("CAM", project)
    dep_a = make_deployment(cam, 1, a, at(1).date(), at(5).date(), HOME)
    dep_b = make_deployment(cam, 2, b, at(6).date(), None, HOME)
    return {
        "a": a, "b": b,
        "at_a": make_image(cam, dep_a, at(2)),
        "at_b": make_image(cam, dep_b, at(7)),
        "no_site": make_image(cam, None, at(9)),
    }


async def listed(session, scope, value) -> set:
    query = select(Image.uuid)
    clause = image_site_filter(scope, value)
    if clause is not None:
        query = query.where(clause)
    return set((await session.execute(query)).scalars())


@pytest.mark.parametrize("value, expected", [
    (None, {"at_a", "at_b", "no_site"}),
    ("{a}", {"at_a"}),
    ("none", {"no_site"}),
    ("none,{a}", {"at_a", "no_site"}),
])
async def test_a_viewer_without_a_site_list(session, photos, value, expected):
    if value:
        value = value.format(a=photos["a"])
    assert await listed(session, None, value) == {photos[k] for k in expected}


@pytest.mark.parametrize("value, expected", [
    (None, {"at_a"}),
    ("{a}", {"at_a"}),
    ("{b}", set()),
    ("none", set()),
    ("none,{a}", {"at_a"}),
])
async def test_a_viewer_with_a_site_list_never_sees_photos_without_a_site(session, photos, value, expected):
    if value:
        value = value.format(a=photos["a"], b=photos["b"])
    assert await listed(session, [photos["a"]], value) == {photos[k] for k in expected}


@pytest.mark.parametrize("interval", [0, 30], ids=["photo by photo", "independent events"])
async def test_the_trend_counts_only_photos_with_a_site(session, photos, admin, interval):
    """The trend chart divides detections by trap effort, which only knows
    deployments. A photo without a site would add detections and no effort,
    so the trend leaves it out. Other callers of the helpers keep it."""
    for key in ("at_a", "at_b", "no_site"):
        make_observation(photos[key], admin.id)
    project = scalar("SELECT id FROM projects")

    async def days(placed_only):
        if interval:
            trend = await get_independent_daily_trend(session, [project], interval, placed_only=placed_only)
        else:
            trend = await get_preferred_daily_trend(session, [project], placed_only=placed_only)
        return {row["date"] for row in trend}

    placed = {at(2).date().isoformat(), at(7).date().isoformat()}
    assert await days(placed_only=True) == placed
    assert await days(placed_only=False) == placed | {at(9).date().isoformat()}
