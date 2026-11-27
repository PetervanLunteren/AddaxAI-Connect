"""
How people correct deployments and sites: change the site of a deployment,
"It did not move", Edit deployment, and site merge and delete. The routes
are called directly with a real session, and each scenario starts from real
photos and a real rebuild.
"""
from datetime import timedelta

import pytest
from fastapi import HTTPException

from deployment_db import (
    at, close, day, deployments, execute, history, HOME, image_deployment, make_camera, make_image,
    make_project, make_site, make_user, offset, rows, scalar, site,
)
from routers.deployments import (
    SetDeploymentRequest, list_statements, not_moved, remove_statement, set_deployment,
)
from routers.sites import MergeSiteRequest, delete_site, merge_site

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=1500)


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


async def test_change_site_is_a_statement_and_leaves_the_pin(session, admin, moved_camera):
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))

    result = await change_site(session, admin, m["project"], m["second"], other)

    second = deployments(m["cam"])[1]
    assert second["id"] == m["second"]
    assert second["site_id"] == other and second["site_source"] == "manual"
    # A correction never moves a pin: Other stays where it was made, 5 km
    # north, not at this camera's GPS. Until 21 November 2026 it moved there.
    assert close(site(other)["lat"], offset(HOME, north_m=5000)[0]) and close(site(other)["lon"], HOME[1])
    [statement] = statements(m["cam"])
    assert result.statement_id == statement["id"]
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


async def test_a_day_after_today_is_refused(session, admin, moved_camera):
    """A deployment that starts later would count as where the camera stands
    now, and a last day still to come would count trap-nights that have not
    happened. Two days ahead, so the test holds in every timezone."""
    from datetime import date
    m = moved_camera
    later = date.today() + timedelta(days=2)
    for days in (dict(from_date=later), dict(from_date=day(9), until_date=later)):
        with pytest.raises(HTTPException) as err:
            await set_deployment(
                m["project"], SetDeploymentRequest(camera_id=m["cam"], site_id=m["home"], **days),
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
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))
    await change_site(session, admin, m["project"], m["second"], other)

    elsewhere = offset(HOME, north_m=9000)
    history(m["cam"], [(elsewhere, at(20)), (elsewhere, at(21))])

    assert [d["site_id"] for d in deployments(m["cam"])][:2] == [m["home"], other]
    assert len(deployments(m["cam"])) == 3


# Back to back at one site


async def test_back_to_the_previous_site_joins_them(session, admin, moved_camera):
    m = moved_camera
    await change_site(session, admin, m["project"], m["second"], m["home"])

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

    await change_site(session, admin, project, second["id"], home)

    assert [d["site_id"] for d in deployments(cam)] == [home, home]


async def test_a_chain_of_three_folds_into_one(session, admin):
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    history(cam, [(HOME, at(1)), (HOME, at(2)), (FAR, at(10)), (FAR, at(11)), (HOME, at(20)), (HOME, at(21))])
    first, middle, last = deployments(cam)
    assert last["site_id"] == home

    await change_site(session, admin, project, middle["id"], home)

    [dep] = deployments(cam)
    assert dep["id"] == first["id"] and dep["end_date"] is None


# It did not move, and the unnamed site a correction empties


async def test_it_did_not_move_folds_back_and_removes_the_unnamed_site(session, admin, moved_camera):
    m = moved_camera
    result = await not_moved(m["project"], m["second"], session, admin)

    [dep] = deployments(m["cam"])
    assert dep["id"] == m["first"] and dep["end_date"] is None
    for image in m["images"]:
        assert image_deployment(image) == m["first"]
    assert site(m["far"]) is None
    [statement] = statements(m["cam"])
    assert result.statement_id == statement["id"]
    assert statement["from_at"] == at(2) and statement["site_id"] == m["home"]
    assert statement["created_by_user_id"] == admin.id


async def test_it_did_not_move_leaves_the_pin_where_the_gps_put_it(session, admin, moved_camera):
    """The photos after the false move are 1.5 km away. Saying the camera
    did not move puts them at Home, but must not drag Home's pin towards
    them: the build snaps other cameras to that pin."""
    m = moved_camera
    before = site(m["home"])
    await not_moved(m["project"], m["second"], session, admin)
    after = site(m["home"])
    assert close(after["lat"], before["lat"]) and close(after["lon"], before["lon"])


async def test_undo_of_it_did_not_move_gives_the_move_back(session, admin):
    """Undo hands the days back to the GPS. More photos after the move than
    before, as with S02 on dev: the one corrected row then matches the part
    after the move, and the rebuild used to keep that row's site, Home, for
    it, so the camera stayed at Home after Undo."""
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    history(cam, [(HOME, at(2)), (HOME, at(3))] + [(FAR, at(d)) for d in (10, 11, 12, 13, 14)])
    _, moved = deployments(cam)

    result = await not_moved(project, moved["id"], session, admin)
    assert len(deployments(cam)) == 1
    await remove_statement(project, result.statement_id, session, admin)

    first, second = deployments(cam)
    assert first["site_id"] == home and first["site_source"] == "auto"
    assert second["site_id"] != home and second["site_source"] == "auto"
    assert close(site(second["site_id"])["lon"], FAR[1], metres=20)
    # The same move is back, by camera and start: what the deployment window
    # finds it by after an Undo, whatever its row id is now.
    assert second["start_at"] == moved["start_at"]


async def test_undo_of_it_stayed_on_a_short_trip_gives_both_moves_back(session, admin):
    """S03 on dev: one burst read far away, then the camera is back home.
    "It stayed" on the trip out takes both moves away; Undo gives both
    back, the trip out under the same start, so the table is as before."""
    project = make_project()
    cam = make_camera("CAM01", project)
    home = make_site(project, "Home", HOME)
    history(cam, [(HOME, at(d)) for d in (2, 3, 4)] + [(FAR, at(10)), (FAR, at(10) + timedelta(seconds=1))]
            + [(HOME, at(d)) for d in (11, 12, 13)])
    before, trip, back = deployments(cam)
    assert before["site_id"] == home and back["site_id"] == home and trip["site_id"] != home

    result = await not_moved(project, trip["id"], session, admin)
    assert len(deployments(cam)) == 1
    await remove_statement(project, result.statement_id, session, admin)

    again = deployments(cam)
    assert [d["site_id"] == home for d in again] == [True, False, True]
    assert [d["start_at"] for d in again] == [before["start_at"], trip["start_at"], back["start_at"]]
    assert all(d["site_source"] == "auto" for d in again)


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


async def test_a_move_the_gps_missed_is_fixed_from_its_day(session, admin):
    """S04 on dev: moved 180 m on day 15, inside the 250 m the GPS rule
    allows, so the app saw one stay. Set site with the new site from day 15
    and no last day splits it: the old site keeps the days before, and its
    pin goes back to where the camera stood there."""
    project = make_project()
    west = make_site(project, "Stream west", HOME)
    east_point = offset(HOME, east_m=180)
    east = make_site(project, "Stream east", east_point)
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 15)] + [(east_point, at(d)) for d in range(15, 21)])
    [one] = deployments(cam)
    assert one["site_id"] == west  # the missed move
    assert not close(site(west)["lon"], HOME[1], metres=50)  # its pin drifted east

    [dep] = rows("SELECT start_date FROM deployments WHERE camera_id = :c", c=cam)
    await set_deployment(project, SetDeploymentRequest(
        camera_id=cam, site_id=east, from_date=day(15), until_date=None), session, admin)

    before, after = deployments(cam)
    assert (before["site_id"], before["site_source"], before["end_date"]) == (west, "auto", day(14))
    assert (after["site_id"], after["site_source"], after["start_date"]) == (east, "manual", day(15))
    assert close(site(west)["lon"], HOME[1], metres=20)  # the pin is back


async def test_a_site_made_on_top_of_another_does_not_take_its_cameras(session, admin):
    """On dev a new site was made exactly on an existing pin, used in a
    correction and the correction undone: the camera then landed on the new
    site, because the nearest of two equally near sites was left to chance.
    The older site wins a tie. Which of two tied rows the database returns
    depends on how they happen to be stored, so this test cannot force the
    wrong order; it holds the outcome, ORDER BY dist, id holds the rule."""
    project = make_project()
    home = make_site(project, "Stream west", HOME)
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 5)])
    on_top = make_site(project, "stream NO", HOME)
    result = await set_deployment(project, SetDeploymentRequest(
        camera_id=cam, site_id=on_top, from_date=day(2), until_date=None), session, admin)
    await remove_statement(project, result.statement_id, session, admin)
    [dep] = deployments(cam)
    assert dep["site_id"] == home


def _s04(project):
    """A camera at Stream west on days 1-14 and 180 m east from day 15."""
    west = make_site(project, "Stream west", HOME)
    east_point = offset(HOME, east_m=180)
    east = make_site(project, "Stream east", east_point)
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 15)] + [(east_point, at(d)) for d in range(15, 21)])
    return cam, west, east


async def edit(session, admin, project, cam, deployment_id, site, from_day, until_day=None):
    return await set_deployment(project, SetDeploymentRequest(
        camera_id=cam, site_id=site, from_date=day(from_day),
        until_date=day(until_day) if until_day else None, deployment_id=deployment_id), session, admin)


async def test_editing_a_corrected_deployment_replaces_its_correction(session, admin):
    """The days an edit leaves out go back to the app, also when a person
    made the deployment: the edit replaces that correction instead of
    stacking on it, where the older one would keep those days."""
    project = make_project()
    cam, west, east = _s04(project)
    [one] = deployments(cam)
    await edit(session, admin, project, cam, one["id"], east, 1)  # first try: Stream east all along
    [corrected] = deployments(cam)
    assert (corrected["site_id"], corrected["site_source"]) == (east, "manual")

    await edit(session, admin, project, cam, corrected["id"], east, 15)  # then: only from day 15
    before, after = deployments(cam)
    assert (before["site_id"], before["site_source"], before["end_date"]) == (west, "auto", day(14))
    assert (after["site_id"], after["site_source"], after["start_date"]) == (east, "manual", day(15))
    assert len([s for s in statements(cam) if s["removed_at"] is None]) == 1


async def test_undo_of_an_edit_brings_back_what_it_replaced(session, admin):
    project = make_project()
    cam, west, east = _s04(project)
    [one] = deployments(cam)
    first = await edit(session, admin, project, cam, one["id"], east, 1)
    [corrected] = deployments(cam)
    second = await edit(session, admin, project, cam, corrected["id"], east, 15)

    await remove_statement(project, second.statement_id, session, admin)
    [back] = deployments(cam)
    assert (back["site_id"], back["site_source"], back["start_date"]) == (east, "manual", day(1))
    [live] = [s for s in statements(cam) if s["removed_at"] is None]
    assert live["id"] == first.statement_id and live["replaced_by_statement_id"] is None


async def test_editing_a_deployment_the_gps_made_replaces_nothing(session, admin):
    project = make_project()
    cam, west, east = _s04(project)
    other = make_camera("OTHER", project)
    history(other, [(HOME, at(1))])
    await set_deployment(project, SetDeploymentRequest(
        camera_id=other, site_id=east, from_date=day(1)), session, admin)
    [one] = deployments(cam)
    await edit(session, admin, project, cam, one["id"], east, 15)
    # The other camera's correction is untouched, and this camera had none.
    assert [s["removed_at"] for s in statements(other)] == [None]


async def test_editing_a_deployment_set_after_the_newest_photo_replaces_its_correction(session, admin):
    """A deployment set to start after the camera's newest photo: its open
    correction holds nothing yet, so only its start says which deployment it
    made. An edit must still replace it. Before, the old correction stayed in
    force and a second open deployment at the same site started after the
    new last day."""
    project = make_project()
    make_site(project, "Home", HOME)
    pond = make_site(project, "Pond", FAR)
    cam = make_camera("S13", project)
    history(cam, [(HOME, at(2))])
    await set_deployment(project, SetDeploymentRequest(
        camera_id=cam, site_id=pond, from_date=day(10)), session, admin)
    _, planned = deployments(cam)

    await edit(session, admin, project, cam, planned["id"], pond, 10, until_day=20)
    _, planned = deployments(cam)
    assert (planned["site_id"], planned["start_date"], planned["end_date"]) == (pond, day(10), day(20))
    assert len([s for s in statements(cam) if s["removed_at"] is None]) == 1


async def test_editing_a_later_deployment_leaves_an_older_open_correction(session, admin, moved_camera):
    """An open correction does not reach every later deployment: the GPS
    moved the camera on after it. Editing the later one must not take the
    older correction back."""
    m = moved_camera
    other = make_site(m["project"], "Other", offset(HOME, north_m=5000))
    older = await change_site(session, admin, m["project"], m["second"], other)
    elsewhere = offset(HOME, north_m=9000)
    history(m["cam"], [(elsewhere, at(20)), (elsewhere, at(21))])
    third = deployments(m["cam"])[2]
    await edit(session, admin, m["project"], m["cam"], third["id"], m["home"], 20)  # now a person's
    third = deployments(m["cam"])[2]

    await edit(session, admin, m["project"], m["cam"], third["id"], m["home"], 20, until_day=25)
    assert [d["site_id"] for d in deployments(m["cam"])][:2] == [m["home"], other]
    [kept] = [s for s in statements(m["cam"]) if s["id"] == older.statement_id]
    assert kept["removed_at"] is None


async def test_changing_only_the_site_keeps_the_time_of_the_move(session, admin):
    """The camera left Home on day 10 in the afternoon, after a last photo
    there that morning. Changing only the site of the first deployment must
    take that photo along. Cut at midnight, it stayed behind as a deployment
    of a few hours at the old site."""
    project = make_project()
    make_site(project, "Home", HOME)
    pond = make_site(project, "Pond", offset(HOME, north_m=5000))
    cam = make_camera("S14", project)
    morning, afternoon = at(10) - timedelta(hours=3), at(10) + timedelta(hours=2)
    history(cam, [(HOME, at(2)), (HOME, at(3)), (HOME, morning), (FAR, afternoon), (FAR, at(11))])
    first, second = deployments(cam)
    assert second["start_at"] == afternoon

    await edit(session, admin, project, cam, first["id"], pond, 2, until_day=9)
    first, second = deployments(cam)
    assert (first["site_id"], first["end_at"], first["site_source"]) == (pond, afternoon, "manual")
    assert second["start_at"] == afternoon


async def test_a_shortened_deployment_splits_in_two_and_each_part_can_be_edited(session, admin):
    """Peter's case: the camera stood at Stream east until day 18 and was
    then moved to Stream west, but the GPS still reads Stream east. Ending
    the deployment on day 18 makes the days after their own deployment,
    even at the same site, so it can be edited on its own. Before, the GPS
    gave the rest Stream east and it joined back into one."""
    project = make_project()
    east = make_site(project, "Stream east", HOME)
    west = make_site(project, "Stream west", offset(HOME, east_m=-180))
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 21)])
    [one] = deployments(cam)

    await edit(session, admin, project, cam, one["id"], east, 1, until_day=18)
    first, rest = deployments(cam)
    assert (first["site_id"], first["end_date"], first["site_source"]) == (east, day(18), "manual")
    assert (rest["site_id"], rest["start_date"], rest["site_source"]) == (east, day(19), "auto")

    await edit(session, admin, project, cam, rest["id"], west, 19)
    first, rest = deployments(cam)
    assert (first["site_id"], first["end_date"]) == (east, day(18))
    assert (rest["site_id"], rest["start_date"], rest["site_source"]) == (west, day(19), "manual")


async def test_it_stayed_still_joins_the_parts_around_a_false_move(session, admin, moved_camera):
    """Only a period set in Edit or Add deployment stands alone; "It stayed"
    must still fold the false move back into one deployment."""
    m = moved_camera
    await not_moved(m["project"], m["second"], session, admin)
    assert len(deployments(m["cam"])) == 1


async def test_a_correction_says_what_it_changed(session, admin):
    """For the line on the deployment card: "Last day set by ...", "Site set
    by ...". Adding a deployment sets all three."""
    project = make_project()
    east = make_site(project, "Stream east", HOME)
    west = make_site(project, "Stream west", offset(HOME, east_m=-180))
    cam = make_camera("S04", project)
    history(cam, [(HOME, at(d)) for d in range(1, 21)])
    [one] = deployments(cam)
    await edit(session, admin, project, cam, one["id"], east, 1, until_day=18)
    _, rest = deployments(cam)
    await edit(session, admin, project, cam, rest["id"], west, 19)
    other = make_camera("NOGPS", project)
    make_image(other, None, at(3))
    await set_deployment(project, SetDeploymentRequest(camera_id=other, site_id=west, from_date=day(3)), session, admin)

    listed = {(s.camera_id, s.site_id): s.changes for s in await list_statements(project, session, admin)}
    assert listed[(cam, east)] == ["last_day"]
    assert listed[(cam, west)] == ["site"]
    assert listed[(other, west)] == ["site", "first_day", "last_day"]
