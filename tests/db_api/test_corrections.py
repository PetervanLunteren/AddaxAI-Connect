"""
How people correct deployments and sites: change the site of a deployment,
"It did not move", and site merge and delete. The routes are called directly
with a real session.

Written in step 1a against code that deleted deployment rows to correct
them. Since step 2a every correction writes a statement and rebuilds the
camera, and each scenario starts from real photos and a real rebuild. Three
outcomes changed on purpose and say so: a correction removes the unnamed
site it emptied, a site merge joins back to back deployments, and a site in
use cannot be deleted. Since step 3b the camera updates panel is gone: its
answers live in the camera updates check (routers/deployments.py).
"""
from datetime import timedelta

import pytest
from fastapi import HTTPException

from deployment_db import (
    DAY, HOME, at, close, deployments, execute, image_deployment, make_camera,
    make_image, make_project, make_site, make_user, offset, rows, scalar, site,
)
from routers.deployments import SetDeploymentRequest, not_moved, set_deployment
from routers.sites import MergeSiteRequest, delete_site, merge_site

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=1500)


def day(n: int):
    return DAY + timedelta(days=n - 1)


def history(camera_id: int, photos: list) -> list[str]:
    """Photos with GPS, then the rebuild, as live ingestion leaves them."""
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    uuids = [make_image(camera_id, None, taken, gps) for gps, taken in photos]
    with get_db_session() as s:
        rebuild_camera(s, camera_id)
    return uuids


@pytest.fixture
def moved_camera():
    """A camera at site Home on days 2 and 3, then 1.5 km east on days 10 and
    11: the app saw a move and made an unnamed site there."""
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    images = history(cam, [(HOME, at(2)), (HOME, at(3)), (FAR, at(10)), (FAR, at(11))])
    first, second = deployments(cam)
    assert site(second["site_id"])["name"].startswith("Site at ")
    return dict(project=project, cam=cam, home=home, far=second["site_id"],
                first=first["id"], second=second["id"], images=images)


async def change_site(session, admin, project, deployment_id, site_id):
    """Wrong site? as the camera panel does it since 2b: the Set deployment
    form, filled with the deployment's own days."""
    [dep] = rows("SELECT camera_id, start_date, end_date FROM deployments WHERE id = :d", d=deployment_id)
    return await set_deployment(
        project,
        SetDeploymentRequest(camera_id=dep["camera_id"], site_id=site_id,
                             from_date=dep["start_date"], until_date=dep["end_date"]),
        session, admin,
    )


def statements(camera_id):
    return rows("SELECT * FROM deployment_statements WHERE camera_id = :c ORDER BY id", c=camera_id)


# Change the site of a deployment


async def test_change_site_is_a_statement_and_moves_the_pins(session, admin, moved_camera):
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))

    result = await change_site(session, admin, m["project"], m["second"], other)

    assert result.merged == 0
    second = deployments(m["cam"])[1]
    assert second["id"] == m["second"]
    assert second["site_id"] == other and second["site_source"] == "manual"
    # The target pin is now the centroid of its one deployment.
    assert close(site(other)["lon"], FAR[1]) and close(site(other)["lat"], FAR[0])
    [statement] = statements(m["cam"])
    assert (statement["site_id"], statement["source"]) == (other, "person")
    assert statement["created_by_user_id"] == admin.id
    assert statement["until_at"] is None and statement["fixed_until_at"] == at(11)


async def test_a_last_day_before_the_first_is_refused(session, admin, moved_camera):
    m = moved_camera
    with pytest.raises(HTTPException) as err:
        await set_deployment(
            m["project"],
            SetDeploymentRequest(camera_id=m["cam"], site_id=m["home"], from_date=day(9), until_date=day(8)),
            session, admin,
        )
    assert err.value.status_code == 422


async def test_a_camera_of_another_project_is_not_found(session, admin, moved_camera):
    other_project = make_project("Other")
    with pytest.raises(HTTPException) as err:
        await set_deployment(
            other_project,
            SetDeploymentRequest(camera_id=moved_camera["cam"], site_id=moved_camera["home"], from_date=day(1)),
            session, admin,
        )
    assert err.value.status_code == 404


async def test_a_corrected_camera_still_moves_later(session, admin, moved_camera):
    """A statement fixes the past, it does not lock the camera."""
    from deployment_db import make_image as photo_row
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))
    await change_site(session, admin, m["project"], m["second"], other)

    elsewhere = offset(HOME, north_m=9000)
    photo_row(m["cam"], None, at(20), elsewhere)
    photo_row(m["cam"], None, at(21), elsewhere)
    with get_db_session() as s:
        rebuild_camera(s, m["cam"])

    assert [d["site_id"] for d in deployments(m["cam"])][:2] == [m["home"], other]
    assert len(deployments(m["cam"])) == 3


# Back to back at one site


async def test_back_to_the_previous_site_joins_them(session, admin, moved_camera):
    m = moved_camera
    result = await change_site(session, admin, m["project"], m["second"], m["home"])

    assert result.merged == 1
    [dep] = deployments(m["cam"])
    assert dep["id"] == m["first"]
    assert dep["start_date"] == day(2) and dep["end_date"] is None  # stays open
    for image in m["images"]:
        assert image_deployment(image) == m["first"]


async def test_empty_days_between_them_is_a_real_redeploy_and_stays_apart(session, admin):
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    execute(
        """INSERT INTO deployment_statements (camera_id, site_id, from_at, until_at, source)
           VALUES (:c, :s, :f, :u, 'upload')""",
        c=cam, s=home, f=at(1, hour=0), u=at(5, hour=0),
    )
    history(cam, [(HOME, at(2)), (FAR, at(8)), (FAR, at(9))])
    first, second = deployments(cam)

    result = await change_site(session, admin, project, second["id"], home)

    assert result.merged == 0
    assert [d["site_id"] for d in deployments(cam)] == [home, home]


async def test_a_chain_of_three_folds_into_one(session, admin):
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    history(cam, [(HOME, at(1)), (HOME, at(2)), (FAR, at(10)), (FAR, at(11)), (HOME, at(20)), (HOME, at(21))])
    first, middle, last = deployments(cam)
    assert last["site_id"] == home

    result = await change_site(session, admin, project, middle["id"], home)

    assert result.merged == 2
    [dep] = deployments(cam)
    assert dep["id"] == first["id"] and dep["end_date"] is None


# It did not move, and the unnamed site a correction empties


async def test_it_did_not_move_folds_back_and_removes_the_unnamed_site(session, admin, moved_camera):
    m = moved_camera
    result = await not_moved(m["project"], m["second"], session, admin)

    assert result.merged == 1
    [dep] = deployments(m["cam"])
    assert dep["id"] == m["first"] and dep["end_date"] is None
    for image in m["images"]:
        assert image_deployment(image) == m["first"]
    assert site(m["far"]) is None
    [statement] = statements(m["cam"])
    assert statement["from_at"] == at(2) and statement["site_id"] == m["home"]
    assert statement["created_by_user_id"] == admin.id


async def test_it_did_not_move_twice_finds_no_deployment(session, admin, moved_camera):
    m = moved_camera
    await not_moved(m["project"], m["second"], session, admin)
    with pytest.raises(HTTPException) as err:
        await not_moved(m["project"], m["second"], session, admin)
    assert err.value.status_code == 404


async def test_it_did_not_move_needs_a_deployment_before(session, admin, moved_camera):
    m = moved_camera
    with pytest.raises(HTTPException) as err:
        await not_moved(m["project"], m["first"], session, admin)
    assert err.value.status_code == 409


async def test_change_site_removes_the_unnamed_site_it_emptied(session, admin, moved_camera):
    m = moved_camera
    other = make_site(m["project"], "Other", offset(FAR, east_m=50))
    await change_site(session, admin, m["project"], m["second"], other)

    assert deployments(m["cam"])[1]["site_id"] == other
    assert site(m["far"]) is None


async def test_a_site_somebody_named_is_never_removed(session, admin, moved_camera):
    m = moved_camera
    execute("UPDATE sites SET name = 'Ridge' WHERE id = :s", s=m["far"])
    await not_moved(m["project"], m["second"], session, admin)

    assert site(m["far"])["name"] == "Ridge"


# Site merge and delete


async def test_site_merge_moves_deployments_and_scopes(session, admin):
    project = make_project()
    cam1, cam2 = make_camera("CAM01", project), make_camera("CAM02", project)
    keep = make_site(project, "Keep", HOME)
    gone = make_site(project, "Gone", offset(HOME, east_m=100))
    history(cam1, [(HOME, at(1))])
    history(cam2, [(offset(HOME, east_m=100), at(1))])
    assert deployments(cam2)[0]["site_id"] == gone
    viewer = make_user("viewer@example.org")
    execute(
        """INSERT INTO project_memberships (user_id, project_id, role, site_ids)
           VALUES (:u, :p, 'project-viewer', CAST(:s AS json))""",
        u=viewer, p=project, s=f"[{gone}]",
    )

    await merge_site(project, gone, MergeSiteRequest(target_site_id=keep), admin, session)

    assert site(gone) is None
    assert deployments(cam2)[0]["site_id"] == keep
    # The surviving pin is the centroid of both deployments.
    assert close(site(keep)["lon"], offset(HOME, east_m=50)[1])
    assert scalar("SELECT site_ids::text FROM project_memberships WHERE user_id = :u", u=viewer) == f"[{keep}]"


async def test_site_merge_moves_statements_and_joins_back_to_back_deployments(session, admin, moved_camera):
    """Changed in 2a: the merge used to leave one camera with two deployments
    back to back at the same site. The rebuild joins them now."""
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))
    await change_site(session, admin, m["project"], m["second"], other)

    await merge_site(m["project"], other, MergeSiteRequest(target_site_id=m["home"]), admin, session)

    [dep] = deployments(m["cam"])
    assert dep["site_id"] == m["home"]
    assert [s["site_id"] for s in statements(m["cam"])] == [m["home"]]


async def test_site_merge_into_itself_is_refused(session, admin, moved_camera):
    m = moved_camera
    with pytest.raises(HTTPException) as err:
        await merge_site(m["project"], m["home"], MergeSiteRequest(target_site_id=m["home"]), admin, session)
    assert err.value.status_code == 400


async def test_a_site_in_use_cannot_be_deleted(session, admin, moved_camera):
    """Changed in 2a: deployments used to lose their site."""
    m = moved_camera
    with pytest.raises(HTTPException) as err:
        await delete_site(m["project"], m["home"], admin, session)
    assert err.value.status_code == 409
    assert site(m["home"]) is not None


async def test_an_unused_site_can_be_deleted(session, admin, moved_camera):
    m = moved_camera
    spare = make_site(m["project"], "Spare", offset(HOME, north_m=8000))
    await delete_site(m["project"], spare, admin, session)
    assert site(spare) is None
