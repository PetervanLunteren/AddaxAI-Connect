"""
Step 3b: the To check list of the Deployments page.

To check = a deployment the GPS made that nobody checked yet, plus each
camera with photos without a site. Checking records who looked and when; it
fixes nothing. The badge count (SQL) and the list (built in the browser from
the deployments list) must say the same.
"""
import pytest

from deployment_db import (
    HOME, at, deployments, make_camera, make_image, make_project, make_site,
    make_statement, offset, rows, to_check,
)
from routers.deployments import CheckedRequest, list_deployments, set_checked, to_check_count

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)


def rebuild(camera_id):
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    with get_db_session() as s:
        rebuild_camera(s, camera_id)


def list_rule(overview) -> int:
    """The rule of components/deployments/review-items.ts."""
    gps = [d for d in overview.deployments if d.site_source == "auto" and d.checked_at is None]
    return len(gps) + len(overview.unplaced)


@pytest.fixture
def project_with_news():
    """A camera that moved, a camera placed by a fixed period, and a camera
    without GPS whose photos have no site."""
    project = make_project()
    mover = make_camera("MOVER", project)
    for day, point in [(1, HOME), (2, HOME), (10, FAR), (11, FAR)]:
        make_image(mover, None, at(day), point)
    rebuild(mover)

    fixed = make_camera("FIXED", project)
    pond = make_site(project, "Pond", offset(HOME, north_m=3000))
    make_image(fixed, None, at(3))
    make_statement(fixed, pond, at(1, hour=0), at(5, hour=0))
    rebuild(fixed)

    lost = make_camera("NOGPS", project)
    make_image(lost, None, at(4))
    make_image(lost, None, at(6))
    rebuild(lost)
    return project, mover, fixed, lost


async def test_gps_deployments_and_photos_without_a_site_are_to_check(session, admin, project_with_news):
    project, mover, fixed, lost = project_with_news
    assert len(to_check(mover)) == 2
    assert to_check(fixed) == []  # a person's word needs no check
    assert (await to_check_count(project, session, admin)).count == 3  # two moves, one camera without a site


async def test_checking_and_undoing(session, admin, project_with_news):
    project, mover, *_ = project_with_news
    first, second = deployments(mover)

    result = await set_checked(project, CheckedRequest(deployment_ids=[second["id"]], checked=True), session, admin)
    assert result.updated == 1
    [left] = to_check(mover)
    assert left["id"] == first["id"]
    [row] = rows("SELECT checked_at, checked_by_user_id FROM deployments WHERE id = :d", d=second["id"])
    assert row["checked_at"] is not None and row["checked_by_user_id"] == admin.id

    await set_checked(project, CheckedRequest(deployment_ids=[second["id"]], checked=False), session, admin)
    assert len(to_check(mover)) == 2
    [row] = rows("SELECT checked_by_user_id FROM deployments WHERE id = :d", d=second["id"])
    assert row["checked_by_user_id"] is None


async def test_checking_leaves_other_projects_alone(session, admin, project_with_news):
    project, mover, *_ = project_with_news
    other = make_project("Other")
    stranger = make_camera("STRANGER", other)
    make_image(stranger, None, at(1), HOME)
    rebuild(stranger)
    [dep] = deployments(stranger)

    result = await set_checked(project, CheckedRequest(deployment_ids=[dep["id"]], checked=True), session, admin)
    assert result.updated == 0
    assert len(to_check(stranger)) == 1


async def test_a_checked_deployment_stays_checked_through_a_rebuild(session, admin, project_with_news):
    project, mover, *_ = project_with_news
    first, second = deployments(mover)
    await set_checked(project, CheckedRequest(deployment_ids=[first["id"]], checked=True), session, admin)
    make_image(mover, None, at(12), FAR)
    rebuild(mover)
    assert [d["id"] for d in to_check(mover)] == [second["id"]]


async def test_the_badge_count_equals_the_list(session, admin, project_with_news):
    project, mover, *_ = project_with_news
    first, _ = deployments(mover)
    for checked in ([], [first["id"]]):
        if checked:
            await set_checked(project, CheckedRequest(deployment_ids=checked, checked=True), session, admin)
        overview = await list_deployments(project, session, admin, None)
        assert list_rule(overview) == (await to_check_count(project, session, admin)).count
