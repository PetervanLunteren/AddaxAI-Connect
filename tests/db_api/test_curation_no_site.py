"""
Curation and photos without a site. The Sites filter takes "none" for
them, as on the Images page, so a link from a camera's "photos have no site
yet" line shows exactly those photos, and a bulk action on that view cannot
reach photos that are placed.
"""
import pytest
from sqlalchemy import select

from deployment_db import HOME, at, day, history, make_camera, make_project, make_site, rows
from routers.image_admin import (
    AdminImageFilterParams, BulkImageActionRequest, _build_filter_clauses, _resolve_target_image_ids,
)
from shared.models import Camera, Image

pytestmark = pytest.mark.asyncio


@pytest.fixture
def placed_and_not():
    """One camera with two photos at Home and two, days earlier and without
    GPS, that no deployment covers. A second camera with one such photo."""
    project = make_project()
    home = make_site(project, "Home", HOME)
    cam = make_camera("MIXED", project)
    placed = history(cam, [(HOME, at(10)), (HOME, at(11))])
    without = history(cam, [(None, at(2)), (None, at(3))])
    other = make_camera("OTHER", project)
    [stray] = history(other, [(None, at(2))])
    return dict(project=project, home=home, cam=cam, placed=set(placed), without=set(without), stray=stray)


async def listed(session, project, **filters) -> set[str]:
    clauses = await _build_filter_clauses(session, project, **filters)
    result = await session.execute(select(Image.uuid).join(Camera, Camera.id == Image.camera_id).where(*clauses))
    return set(result.scalars())


async def test_none_lists_only_the_photos_without_a_site(session, placed_and_not):
    p = placed_and_not
    assert await listed(session, p["project"], site_id="none") == p["without"] | {p["stray"]}


async def test_a_site_still_lists_only_its_photos(session, placed_and_not):
    p = placed_and_not
    assert await listed(session, p["project"], site_id=str(p["home"])) == p["placed"]


async def test_a_site_and_none_together(session, placed_and_not):
    p = placed_and_not
    both = await listed(session, p["project"], site_id=f"{p['home']},none")
    assert both == p["placed"] | p["without"] | {p["stray"]}


async def test_the_link_of_one_camera_shows_exactly_its_photos_without_a_site(session, placed_and_not):
    """Camera, days and "none": what "Open in Curation" on the camera sends."""
    p = placed_and_not
    found = await listed(
        session, p["project"], camera_id=p["cam"], site_id="none",
        start_date=day(2).isoformat(), end_date=day(11).isoformat(),
    )
    assert found == p["without"]


async def test_select_all_on_that_view_never_reaches_a_placed_photo(session, placed_and_not):
    p = placed_and_not
    body = BulkImageActionRequest(filters=AdminImageFilterParams(camera_id=p["cam"], site_id="none"))
    ids, _, errors = await _resolve_target_image_ids(session, p["project"], body)
    uuids = {r["uuid"] for r in rows("SELECT uuid FROM images WHERE id = ANY(:i)", i=ids)}
    assert (uuids, errors) == (p["without"], [])
