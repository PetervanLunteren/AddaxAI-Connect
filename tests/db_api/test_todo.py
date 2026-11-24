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
    HOME, at, execute, make_camera, make_deployment, make_image, make_member, make_project,
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
        return [SimpleNamespace(status="healthy")]
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
        return [SimpleNamespace(status="healthy"), SimpleNamespace(status="unhealthy")]
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


# Not needed: only for the lines that are a choice, for everyone, undoable


async def test_choose_species_marked_not_needed_hides_it_for_everyone(session):
    from utils.todo import list_not_needed, mark_not_needed, may_mark, undo_not_needed
    project = make_project(model=FIXED_MODEL)
    admin = member(project, "project-admin", email="project-admin@example.org")
    other_admin = server_admin()
    viewer = member(project, email="viewer@example.org")
    assert not await may_mark(viewer, "choose_species", project, session)
    assert await may_mark(admin, "choose_species", project, session)

    await mark_not_needed(admin, "choose_species", project, session)
    assert await lines(session, admin, project) == {}
    assert await lines(session, other_admin, project) == {}
    [mark] = await list_not_needed(other_admin, session)
    assert (mark.kind, mark.project_id, mark.by) == ("choose_species", project, "project-admin@example.org")
    assert await list_not_needed(viewer, session) == []

    await undo_not_needed("choose_species", project, session)
    assert await lines(session, admin, project) == {"choose_species": 1}


async def test_a_mark_stays_with_its_project(session):
    from utils.todo import mark_not_needed
    a, b = make_project("A", model=FIXED_MODEL), make_project("B", model=FIXED_MODEL)
    admin = server_admin()
    await mark_not_needed(admin, "choose_species", a, session)
    assert await lines(session, admin, a) == {}
    assert await lines(session, admin, b) == {"choose_species": 1}


async def test_only_lines_that_are_a_choice_can_be_marked(session):
    from utils.todo import may_mark
    project = make_project()
    admin = server_admin()
    for kind in ("low_battery", "suspicious_moves", "services_down", "my_tasks"):
        assert not await may_mark(admin, kind, project, session)
        assert not await may_mark(admin, kind, None, session)
    # A server line is a server admin's, and has no project.
    project_admin = member(project, "project-admin")
    assert not await may_mark(project_admin, "telegram_not_set_up", None, session)
    assert not await may_mark(admin, "telegram_not_set_up", project, session)
    assert await may_mark(admin, "telegram_not_set_up", None, session)


async def test_unknown_files_come_back_with_a_newer_file(session):
    from utils.todo import mark_not_needed
    admin = server_admin()
    make_rejection(None, None, days_ago=1)
    await mark_not_needed(admin, "unknown_camera_files", None, session)
    assert await lines(session, admin) == {}
    make_rejection(None, None)  # arrives after the mark
    assert await lines(session, admin) == {"unknown_camera_files": 1}


async def test_telegram_marked_not_needed(session):
    from utils.todo import mark_not_needed, undo_not_needed
    execute("UPDATE telegram_config SET is_configured = false")
    admin = server_admin()
    await mark_not_needed(admin, "telegram_not_set_up", None, session)
    assert await lines(session, admin) == {}
    await undo_not_needed("telegram_not_set_up", None, session)
    assert await lines(session, admin) == {"telegram_not_set_up": 1}
