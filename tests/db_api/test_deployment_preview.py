"""
The preview of an edit in the Edit deployment form: the same edit as Save
(_apply), in a transaction that is rolled back. So what the form shows
after saving is the rebuild's own answer, and nothing of the preview stays.
"""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from deployment_db import (
    DAY, HOME, at, deployments, make_camera, make_image, make_project, make_site, offset, rows, scalar,
)
from routers.deployments import SetDeploymentRequest, preview_deployment, set_deployment
from shared.models import User

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=1500)


def day(n: int) -> date:
    return DAY + timedelta(days=n - 1)


def history(camera_id: int, photos: list) -> None:
    """Photos with GPS, then the rebuild, as live ingestion leaves them."""
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    for gps, taken in photos:
        make_image(camera_id, None, taken, gps)
    with get_db_session() as s:
        rebuild_camera(s, camera_id)


def cards(listed) -> list:
    """What a card shows: site, days, photos."""
    return [(c.site_id, c.start_date, c.end_date, c.image_count) for c in listed]


def saved(camera_id: int) -> list:
    return [
        (d["site_id"], d["start_date"].isoformat(), d["end_date"].isoformat() if d["end_date"] else None,
         scalar("SELECT count(*) FROM images WHERE deployment_id = :d", d=d["id"]))
        for d in deployments(camera_id)
    ]


def everything(project_id: int, camera_id: int) -> dict:
    """All a preview could touch, to prove it leaves nothing behind."""
    return {
        "deployments": rows("""SELECT id, site_id, site_source, start_at, end_at FROM deployments
                               WHERE camera_id = :c ORDER BY id""", c=camera_id),
        "statements": rows("""SELECT id, removed_at FROM deployment_statements
                              WHERE camera_id = :c ORDER BY id""", c=camera_id),
        "photos": rows("SELECT id, deployment_id FROM images WHERE camera_id = :c ORDER BY id", c=camera_id),
        "sites": rows("SELECT id, name FROM sites WHERE project_id = :p ORDER BY id", p=project_id),
    }


@pytest.fixture
def stream():
    """A camera at Stream east on days 1 to 20."""
    project = make_project()
    east = make_site(project, "Stream east", HOME)
    west = make_site(project, "Stream west", offset(HOME, east_m=-180))
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 21)])
    [only] = deployments(cam)
    return dict(project=project, east=east, west=west, cam=cam, dep=only["id"])


def edit(s, site, first, last=None, deployment=True) -> SetDeploymentRequest:
    return SetDeploymentRequest(
        camera_id=s["cam"], site_id=site, from_date=day(first),
        until_date=day(last) if last else None, deployment_id=s["dep"] if deployment else None,
    )


@pytest.mark.parametrize("change", ["split", "site", "later first day"])
async def test_the_preview_is_what_the_save_does(session, admin, stream, change):
    request = {
        "split": edit(stream, stream["east"], 1, 18),
        "site": edit(stream, stream["west"], 1),
        "later first day": edit(stream, stream["east"], 5),
    }[change]
    before = saved(stream["cam"])

    preview = await preview_deployment(stream["project"], request, session, admin)
    assert cards(preview.before) == before
    await set_deployment(stream["project"], request, session, admin)
    assert cards(preview.after) == saved(stream["cam"])
    assert cards(preview.after) != before


async def test_the_preview_of_a_split_shows_both_parts(session, admin, stream):
    preview = await preview_deployment(stream["project"], edit(stream, stream["east"], 1, 18), session, admin)
    assert cards(preview.after) == [
        (stream["east"], day(1).isoformat(), day(18).isoformat(), 18),
        (stream["east"], day(19).isoformat(), None, 2),
    ]


async def test_a_preview_leaves_nothing_behind(session, admin):
    """Also not the unnamed site the edit would empty and delete."""
    project = make_project()
    home = make_site(project, "Home", HOME)
    cam = make_camera("FAR", project)
    history(cam, [(FAR, at(d)) for d in range(1, 6)])
    [only] = deployments(cam)
    assert only["site_id"] != home
    untouched = everything(project, cam)

    preview = await preview_deployment(
        project, SetDeploymentRequest(camera_id=cam, site_id=home, from_date=day(1), deployment_id=only["id"]),
        session, admin,
    )
    assert [c.site_id for c in preview.after] == [home]
    assert everything(project, cam) == untouched


async def test_a_preview_reads_nothing_after_its_rollback(session, admin, stream):
    """A rollback expires every object of the session, the user as well.
    With a real user loaded through the session (the other tests pass a plain
    one) the preview must still answer."""
    user = await session.get(User, admin.id)
    preview = await preview_deployment(stream["project"], edit(stream, stream["east"], 1, 18), session, user)
    assert len(preview.after) == 2


async def test_a_preview_without_gps_shows_the_new_deployment(session, admin):
    project = make_project()
    meadow = make_site(project, "Meadow", HOME)
    cam = make_camera("NOGPS", project)
    for d in range(3, 8):
        make_image(cam, None, at(d))
    preview = await preview_deployment(
        project, SetDeploymentRequest(camera_id=cam, site_id=meadow, from_date=day(3)), session, admin,
    )
    assert cards(preview.before) == []
    assert cards(preview.after) == [(meadow, day(3).isoformat(), None, 5)]
    assert deployments(cam) == []


@pytest.mark.parametrize("first, last, code", [
    (day(10), day(5), 422),                 # last day before the first
    (date(202, 11, 18), None, 422),         # a year typed digit by digit
    (day(1), date(9999, 12, 31), 422),      # would overflow the day after
])
@pytest.mark.parametrize("route", [preview_deployment, set_deployment])
async def test_bad_days_are_refused_by_preview_and_save(session, admin, stream, route, first, last, code):
    request = SetDeploymentRequest(camera_id=stream["cam"], site_id=stream["east"], from_date=first,
                                   until_date=last, deployment_id=stream["dep"])
    untouched = everything(stream["project"], stream["cam"])
    with pytest.raises(HTTPException) as refused:
        await route(stream["project"], request, session, admin)
    assert refused.value.status_code == code
    await session.rollback()
    assert everything(stream["project"], stream["cam"]) == untouched


async def test_an_unknown_site_is_refused_by_the_preview(session, admin, stream):
    with pytest.raises(HTTPException) as refused:
        await preview_deployment(stream["project"], edit(stream, 999999, 1), session, admin)
    assert refused.value.status_code == 404


async def test_a_card_knows_the_days_of_its_first_and_last_photo(session, admin, stream):
    """The form's hints name the photos of the deployment being edited. A
    person can start a deployment before its first photo, so its first day
    and its first photo day differ."""
    request = SetDeploymentRequest(
        camera_id=stream["cam"], site_id=stream["east"], from_date=day(-2), until_date=day(18),
        deployment_id=stream["dep"],
    )
    preview = await preview_deployment(stream["project"], request, session, admin)
    assert [(c.start_date, c.first_photo_day, c.last_photo_day) for c in preview.after] == [
        (day(-2).isoformat(), day(1).isoformat(), day(18).isoformat()),
        (day(19).isoformat(), day(19).isoformat(), day(20).isoformat()),
    ]
