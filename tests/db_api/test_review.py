"""
Step 3b: the Moves page and its check.

A move is a deployment the GPS made. A person may say "It moved", which
records who looked and when and fixes nothing. A move nobody checked that
came back within a week is suspicious; the To do list counts those in
SQL (utils/todo.py), the page marks them in the browser from the
deployments list, and the two must say the same. Photos without a site are the Cameras page's, not
counted here.
"""
from datetime import datetime

import pytest

from deployment_db import (
    HOME, at, deployments, make_camera, make_image, make_project, make_site,
    make_statement, offset, rows, to_check,
    execute,
)
from sqlalchemy import text

from routers.deployments import CheckedRequest, list_deployments, set_checked
from utils.todo import SUSPICIOUS_MOVES_SQL

pytestmark = pytest.mark.asyncio

FAR = offset(HOME, east_m=2000)


def rebuild(camera_id):
    from shared.database import get_db_session
    from shared.deployment_rebuild import rebuild_camera
    with get_db_session() as s:
        rebuild_camera(s, camera_id)


async def suspicious(project, session) -> int:
    """The To do count of suspicious moves of one project."""
    result = await session.execute(text(SUSPICIOUS_MOVES_SQL), {"project_ids": [project]})
    return len(result.all())


def list_rule(listed) -> int:
    """suspicious in components/deployments/moves.ts, in Python."""
    by_camera = {}
    for d in listed:
        by_camera.setdefault(d.camera_id, []).append(d)
    count = 0
    for deps in by_camera.values():
        deps.sort(key=lambda d: d.start_at)
        for i, d in enumerate(deps):
            if d.site_source != "auto" or d.checked_at is not None:
                continue
            before = deps[i - 1] if i and deps[i - 1].end_at == d.start_at else None
            after = deps[i + 1] if i + 1 < len(deps) and deps[i + 1].start_at == d.end_at else None
            short_trip = (
                before is not None and after is not None and after.site_id == before.site_id
                and (datetime.fromisoformat(d.end_at) - datetime.fromisoformat(d.start_at)).days <= 7
            )
            if short_trip:
                count += 1
    return count


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


async def test_what_needs_a_person(session, admin, project_with_news):
    """Nothing here needs a person. The mover's moves are updates nobody
    answered, which is fine; the fixed camera is a person's word; the
    camera without GPS is the Cameras page's to show, not this count's."""
    project, mover, fixed, lost = project_with_news
    assert len(to_check(mover)) == 2
    assert to_check(fixed) == []
    assert await suspicious(project, session) == 0


async def test_a_move_that_came_back_within_a_week_needs_a_person(session, admin):
    project = make_project()
    home = make_site(project, "Home", HOME)
    far = make_site(project, "Far", FAR)
    cam = make_camera("TRIP", project)
    for day, point in [(1, HOME), (2, HOME), (10, FAR), (10, FAR), (11, HOME), (12, HOME)]:
        make_image(cam, None, at(day, hour=6 + len(rows("SELECT 1 FROM images"))), point)
    rebuild(cam)
    first, trip, back = deployments(cam)
    assert (first["site_id"], trip["site_id"], back["site_id"]) == (home, far, home)

    # Only the trip out is marked, not the start and not the way back. The
    # page's rule says the same.
    assert await suspicious(project, session) == 1
    assert list_rule(await list_deployments(project, session, admin, None)) == 1
    await set_checked(project, CheckedRequest(deployment_ids=[trip["id"]], checked=True), session, admin)
    assert await suspicious(project, session) == 0
    assert list_rule(await list_deployments(project, session, admin, None)) == 0


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


async def test_the_todo_count_equals_the_list(session, admin, project_with_news):
    project, mover, *_ = project_with_news
    first, _ = deployments(mover)
    for checked in ([], [first["id"]]):
        if checked:
            await set_checked(project, CheckedRequest(deployment_ids=checked, checked=True), session, admin)
        listed = await list_deployments(project, session, admin, None)
        count = await suspicious(project, session)
        assert list_rule(listed) == count
    assert count == 0


# Sites from a CSV


class Upload:
    """What the route reads of an uploaded file."""
    def __init__(self, text: str, filename: str = "sites.csv"):
        self.filename, self._text = filename, text

    async def read(self) -> bytes:
        return self._text.encode("utf-8")


async def test_sites_from_a_csv(session, admin):
    from routers.sites import import_sites_csv
    project = make_project()
    make_site(project, "Pond", HOME)
    csv_text = (
        "Name;Latitude;Longitude;Notes\n"
        "Ridge;53.27;5.19;on the dike\n"
        "Pond;53.26;5.18;\n"           # the name is taken
        "ridge;53.28;5.20;\n"          # the name is taken by the row above
        "Marsh;north;5.21;\n"          # not a number
        "Heath;95;5.22;\n"             # out of range
        ";53.2;5.2;\n"                 # no name
    )
    result = await import_sites_csv(project, Upload(csv_text), admin, session)

    assert (result.success_count, result.failed_count) == (1, 5)
    assert [r.success for r in result.results] == [True, False, False, False, False, False]
    assert result.results[1].row_number == 3 and "already exists" in result.results[1].error
    [ridge] = rows("SELECT name, notes, ST_Y(location::geometry) AS lat FROM sites WHERE name = 'Ridge'")
    assert ridge["notes"] == "on the dike" and abs(ridge["lat"] - 53.27) < 1e-9
    assert len(rows("SELECT 1 FROM sites")) == 2


# The photos the check shows


async def test_the_first_and_last_photos_of_a_deployment(session, admin):
    from routers.deployments import deployment_thumbnails
    project = make_project()
    cam = make_camera("PHOTOS", project)
    for day in (1, 2, 3, 4):
        make_image(cam, None, at(day), HOME)
    hidden = make_image(cam, None, at(5), HOME)
    execute("UPDATE images SET is_hidden = true WHERE uuid = :u", u=hidden)
    rebuild(cam)
    [dep] = deployments(cam)

    first = await deployment_thumbnails(project, dep["id"], 2, "first", session, admin, None)
    last = await deployment_thumbnails(project, dep["id"], 1, "last", session, admin, None)
    some = await deployment_thumbnails(project, dep["id"], 6, "random", session, admin, None)

    assert [p.captured_at for p in first.photos] == [at(1).isoformat(), at(2).isoformat()]
    assert [p.captured_at for p in last.photos] == [at(4).isoformat()]  # the hidden one is left out
    assert len(some.photos) == 4
