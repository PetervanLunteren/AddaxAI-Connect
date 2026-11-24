"""
The To do list (utils/todo.py): what needs somebody now, per project.

Each line is there while its rule holds and gone when it is fixed. Who sees
a line follows the role: camera health for every member at the sites they
may see, tasks for whom they are assigned to, the rest for project admins,
the server lines for server admins. The camera lines read the same rows as
the Cameras page, so the page and the list never disagree.
"""
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from deployment_db import (
    HOME, at, execute, rows, make_camera, make_deployment, make_image, make_member, make_project,
    make_rejection, make_site, make_task, make_user, set_health,
)
from utils.todo import todo_for

pytestmark = pytest.mark.asyncio

FIXED_MODEL = "EUR-DF-v1-4"  # DeepFaune: a fixed-class model asks for a species list


@pytest.fixture(autouse=True)
def healthy_server(monkeypatch):
    """The health checks probe Redis and other containers; here all is well
    unless a test says otherwise."""
    import routers.health

    async def all_healthy(db):
        return [SimpleNamespace(name="api", status="healthy")]
    monkeypatch.setattr(routers.health, "collect_services_health", all_healthy)
    execute("DELETE FROM telegram_config")
    execute("INSERT INTO telegram_config (is_configured) VALUES (true)")


def server_admin():
    return SimpleNamespace(id=make_user(), is_superuser=True)


def member(project, role="project-viewer", site_ids=None, email="member@example.org"):
    return SimpleNamespace(id=make_member(project, role, site_ids, email), is_superuser=False)


def live_camera(device_id, project, days_since_contact=0):
    """A camera that sent a live photo, `days_since_contact` days ago."""
    cam = make_camera(device_id, project)
    make_image(cam, None, at(1), HOME)
    execute("UPDATE images SET ingested_at = now() - make_interval(days => :d) WHERE camera_id = :c",
            d=days_since_contact, c=cam)
    return cam


def placed_camera(device_id, project, site):
    """A live camera with a deployment at `site`, so it has a current site
    and no photos without one."""
    cam = make_camera(device_id, project)
    dep = make_deployment(cam, 1, site, date(2026, 3, 1), None, HOME)
    make_image(cam, dep, at(1), HOME)
    return cam


async def lines(session, user, project=None):
    """{kind: count} of one project, or of the server when project is None."""
    todo = await todo_for(user, session)
    if project is None:
        return {i.kind: i.count for i in todo.server}
    found = [p for p in todo.projects if p.project_id == project]
    return {i.kind: i.count for i in found[0].items} if found else {}


# Camera health


async def test_battery_and_sd_limits(session):
    project = make_project()
    site = make_site(project, "Home", HOME)
    for name, battery, sd in [("B29", 29, 10), ("B30", 30, 10), ("SD81", 90, 81), ("SD80", 90, 80)]:
        set_health(placed_camera(name, project, site), battery, sd)
    assert await lines(session, server_admin(), project) == {"low_battery": 1, "sd_nearly_full": 1}


async def test_a_fixed_camera_leaves_the_list(session):
    project = make_project()
    cam = placed_camera("CAM", project, make_site(project, "Home", HOME))
    set_health(cam, battery=12)
    admin = server_admin()
    assert (await lines(session, admin, project))["low_battery"] == 1
    set_health(cam, battery=100)
    assert await lines(session, admin, project) == {}


async def test_inactive_after_a_week_of_silence(session):
    project = make_project()
    site = make_site(project, "Home", HOME)
    silent = placed_camera("SILENT", project, site)
    execute("UPDATE images SET ingested_at = now() - interval '8 days' WHERE camera_id = :c", c=silent)
    placed_camera("TALKING", project, site)
    assert await lines(session, server_admin(), project) == {"inactive": 1}


async def test_retired_and_never_reported_cameras_never_count(session):
    project = make_project()
    retired = make_camera("RETIRED", project)
    set_health(retired, battery=5, sd=99)
    execute("UPDATE cameras SET retired_at = now(), sim_expiry_date = '2020-01-01' WHERE id = :c", c=retired)
    silent_from_birth = make_camera("NEW", project)
    set_health(silent_from_birth, battery=5, sd=99)
    assert await lines(session, server_admin(), project) == {}


# Admin lines


async def test_admin_lines(session, monkeypatch):
    project = make_project(model=FIXED_MODEL)
    site = make_site(project, "Home", HOME)
    live_camera("UNPLACED", project)  # a photo without a deployment
    rejecting = placed_camera("REJECTING", project, site)
    make_rejection(rejecting, project)  # newer than its last live photo
    sim = placed_camera("SIM", project, site)
    execute("UPDATE cameras SET sim_expiry_date = CURRENT_DATE + 10 WHERE id = :c", c=sim)
    execute("""INSERT INTO project_integrations (project_id, kind, config, health_status)
               VALUES (:p, 'earthranger', CAST('{}' AS json), 'error')""", p=project)

    todo = await todo_for(server_admin(), session)
    [found] = todo.projects
    assert {i.kind: i.count for i in found.items} == {
        "unplaced_photos": 1, "rejecting": 1, "sim_expiring": 1,
        "integration_error": 1, "choose_species": 1,
    }
    assert [i.target for i in found.items if i.kind == "integration_error"] == ["earthranger"]


async def test_a_species_list_or_speciesnet_asks_for_nothing(session):
    narrowed = make_project("Narrowed", model=FIXED_MODEL)
    execute("UPDATE projects SET included_species = CAST('[\"fox\"]' AS json) WHERE id = :p", p=narrowed)
    speciesnet = make_project("SpeciesNet")
    admin = server_admin()
    assert await lines(session, admin, narrowed) == {}
    assert await lines(session, admin, speciesnet) == {}


async def test_suspicious_moves_are_counted_per_project(session):
    """The rule itself is tested in test_review.py; here only that the count
    lands under its own project, for admins."""
    project = make_project()
    home, far = make_site(project, "Home", HOME), make_site(project, "Far", HOME)
    cam = make_camera("TRIP", project)
    make_deployment(cam, 1, home, date(2026, 3, 1), date(2026, 3, 9), HOME)
    make_deployment(cam, 2, far, date(2026, 3, 10), date(2026, 3, 10), HOME)
    make_deployment(cam, 3, home, date(2026, 3, 11), None, HOME)
    make_project("Other")
    assert (await lines(session, server_admin(), project))["suspicious_moves"] == 1
    assert "suspicious_moves" not in await lines(session, member(project), project)


# Tasks


async def test_my_tasks_and_the_overdue_ones_of_others(session):
    project = make_project()
    cam = placed_camera("CAM", project, make_site(project, "Home", HOME))
    admin = member(project, "project-admin", email="admin@example.org")
    viewer = member(project, email="viewer@example.org")
    yesterday = date.today() - timedelta(days=1)
    make_task(cam, assigned_to=admin.id, due=yesterday)
    make_task(cam, assigned_to=admin.id)
    make_task(cam, assigned_to=viewer.id, due=yesterday)
    make_task(cam, due=yesterday)  # nobody's
    make_task(cam)  # nobody's, no date

    todo = await todo_for(admin, session)
    [mine] = [i for i in todo.projects[0].items if i.kind == "my_tasks"]
    assert (mine.count, mine.overdue) == (2, 1)
    # The viewer's and nobody's overdue task; not the admin's own again.
    assert (await lines(session, admin, project))["overdue_tasks"] == 2
    assert await lines(session, viewer, project) == {"my_tasks": 1}


# Who sees what


async def test_a_viewer_sees_camera_health_and_own_tasks_only(session):
    project = make_project(model=FIXED_MODEL)
    site = make_site(project, "Home", HOME)
    cam = placed_camera("CAM", project, site)
    set_health(cam, battery=10)
    make_rejection(cam, project)  # fixed in the field, like a battery
    execute("UPDATE cameras SET sim_expiry_date = CURRENT_DATE WHERE id = :c", c=cam)
    live_camera("UNPLACED", project)
    viewer = member(project)
    assert await lines(session, viewer, project) == {"low_battery": 1, "rejecting": 1}


async def test_a_site_restricted_viewer_sees_only_cameras_at_their_sites(session):
    project = make_project()
    mine, other = make_site(project, "Mine", HOME), make_site(project, "Other", HOME)
    for name, site in [("MINE", mine), ("OTHER", other)]:
        set_health(placed_camera(name, project, site), battery=10)
    nowhere = live_camera("NOWHERE", project)  # no current site
    set_health(nowhere, battery=10)
    # A rejection has no site: a restricted viewer sees none anywhere.
    make_rejection(nowhere, project)
    viewer = member(project, site_ids=[mine])
    assert await lines(session, viewer, project) == {"low_battery": 1}
    assert (await lines(session, server_admin(), project))["low_battery"] == 3


async def test_a_stranger_gets_nothing(session):
    project = make_project()
    set_health(placed_camera("CAM", project, make_site(project, "Home", HOME)), battery=10)
    other = make_project("Other")
    stranger = member(other)
    todo = await todo_for(stranger, session)
    assert todo.projects == [] and todo.server == []


async def test_each_project_has_its_own_lines(session):
    a, b = make_project("A"), make_project("B")
    set_health(placed_camera("A1", a, make_site(a, "Home", HOME)), battery=10)
    set_health(placed_camera("B1", b, make_site(b, "Home", HOME)), sd=95)
    admin = server_admin()
    assert await lines(session, admin, a) == {"low_battery": 1}
    assert await lines(session, admin, b) == {"sd_nearly_full": 1}


# Server


async def test_server_lines_for_server_admins_only(session, monkeypatch):
    import routers.health

    async def one_down(db):
        return [SimpleNamespace(name="api", status="healthy"), SimpleNamespace(name="redis", status="unhealthy")]
    monkeypatch.setattr(routers.health, "collect_services_health", one_down)
    execute("UPDATE telegram_config SET is_configured = false")
    make_rejection(None, None)  # a file of no known camera
    make_rejection(None, None, days_ago=8)  # too old to nag about
    project = make_project()

    assert await lines(session, server_admin()) == {
        "services_down": 1, "unknown_camera_files": 1, "telegram_not_set_up": 1,
    }
    assert await lines(session, member(project, "project-admin")) == {}


async def test_a_healthy_server_has_no_lines(session):
    assert await lines(session, server_admin()) == {}


# Dismiss: quiet for one person, loud again when something new appears


async def quiet(session, user, project=None):
    """{kind: quiet} of one project, or of the server when project is None."""
    return {i.kind: i.quiet for i in await items_of(session, user, project)}


async def items_of(session, user, project=None):
    todo = await todo_for(user, session)
    return todo.server if project is None else next(
        (p.items for p in todo.projects if p.project_id == project), [])


async def dismiss_as_seen(session, user, project, *kinds, target=None):
    """Dismiss lines as the panel does: with the keys the user was shown."""
    from utils.todo import DismissLine, dismiss
    shown = await items_of(session, user, project)
    await dismiss(user, [
        DismissLine(kind=i.kind, project_id=project, target=i.target, keys=i.keys)
        for i in shown if i.kind in kinds and (target is None or i.target == target)
    ], session)


async def test_a_dismissed_line_stays_quiet_until_a_new_camera_joins(session):
    project = make_project()
    site = make_site(project, "Home", HOME)
    set_health(placed_camera("CAM1", project, site), battery=10)
    admin = server_admin()
    await dismiss_as_seen(session, admin, project, "low_battery")
    # Still in the list, with its count, but quiet.
    [line] = await items_of(session, admin, project)
    assert (line.count, line.quiet, line.new) == (1, True, None)

    set_health(placed_camera("CAM2", project, site), battery=12)
    [line] = await items_of(session, admin, project)
    assert (line.count, line.quiet, line.new) == (2, False, 1)


async def test_a_line_never_dismissed_has_no_new_count(session):
    project = make_project()
    set_health(placed_camera("CAM", project, make_site(project, "Home", HOME)), battery=10)
    [line] = await items_of(session, server_admin(), project)
    assert (line.quiet, line.new) == (False, None)


async def test_a_camera_that_arrived_after_the_panel_opened_stays_new(session):
    """Dismiss stores what the user saw, not what the server has at the
    click."""
    from utils.todo import DismissLine, dismiss
    project = make_project()
    site = make_site(project, "Home", HOME)
    first = placed_camera("CAM1", project, site)
    set_health(first, battery=10)
    admin = server_admin()
    [seen] = await items_of(session, admin, project)  # the panel opens
    set_health(placed_camera("CAM2", project, site), battery=12)  # arrives meanwhile
    await dismiss(admin, [DismissLine(kind="low_battery", project_id=project, keys=seen.keys)], session)
    [line] = await items_of(session, admin, project)
    assert (line.count, line.quiet, line.new) == (2, False, 1)


async def test_keys_the_user_was_not_shown_are_not_stored(session):
    from utils.todo import DismissLine, dismiss
    project = make_project()
    set_health(placed_camera("CAM", project, make_site(project, "Home", HOME)), battery=10)
    admin = server_admin()
    await dismiss(admin, [DismissLine(kind="low_battery", project_id=project, keys=["99999"])], session)
    assert rows("SELECT 1 FROM todo_dismissals") == []


async def test_the_same_camera_failing_again_is_new(session):
    project = make_project()
    cam = placed_camera("CAM", project, make_site(project, "Home", HOME))
    set_health(cam, battery=10)
    admin = server_admin()
    await dismiss_as_seen(session, admin, project, "low_battery")
    set_health(cam, battery=100)
    assert await lines(session, admin, project) == {}  # fixed: the line and its dismissal go
    set_health(cam, battery=10)
    assert await quiet(session, admin, project) == {"low_battery": False}


async def test_partly_recovered_stays_quiet(session):
    project = make_project()
    site = make_site(project, "Home", HOME)
    cams = [placed_camera(f"CAM{n}", project, site) for n in range(3)]
    for cam in cams:
        set_health(cam, battery=10)
    admin = server_admin()
    await dismiss_as_seen(session, admin, project, "low_battery")
    set_health(cams[0], battery=100)
    [line] = await items_of(session, admin, project)
    assert (line.count, line.quiet) == (2, True)


async def test_dismiss_is_for_one_person(session):
    project = make_project()
    set_health(placed_camera("CAM", project, make_site(project, "Home", HOME)), battery=10)
    me = member(project, email="me@example.org")
    colleague = member(project, email="colleague@example.org")
    await dismiss_as_seen(session, me, project, "low_battery")
    assert await quiet(session, me, project) == {"low_battery": True}
    assert await quiet(session, colleague, project) == {"low_battery": False}


async def test_lines_nobody_can_add_to_stay_quiet(session):
    """Species and Telegram never get a new item: once dismissed they stay
    quiet."""
    execute("UPDATE telegram_config SET is_configured = false")
    project = make_project(model=FIXED_MODEL)
    admin = server_admin()
    await dismiss_as_seen(session, admin, project, "choose_species")
    await dismiss_as_seen(session, admin, None, "telegram_not_set_up")
    assert await quiet(session, admin, project) == {"choose_species": True}
    assert await quiet(session, admin) == {"telegram_not_set_up": True}


async def test_one_integration_dismissed_leaves_the_other_loud(session):
    project = make_project()
    for kind in ("earthranger", "sensingclues"):
        execute("""INSERT INTO project_integrations (project_id, kind, config, health_status)
                   VALUES (:p, :k, CAST('{}' AS json), 'error')""", p=project, k=kind)
    admin = server_admin()
    await dismiss_as_seen(session, admin, project, "integration_error", target="earthranger")
    assert {i.target: i.quiet for i in await items_of(session, admin, project)} == {
        "earthranger": True, "sensingclues": False}


async def test_unknown_files_turn_loud_with_a_new_file(session):
    admin = server_admin()
    make_rejection(None, None, days_ago=1)
    await dismiss_as_seen(session, admin, None, "unknown_camera_files")
    assert await quiet(session, admin) == {"unknown_camera_files": True}
    make_rejection(None, None)
    [line] = await items_of(session, admin)
    assert (line.count, line.quiet, line.new) == (2, False, 1)
