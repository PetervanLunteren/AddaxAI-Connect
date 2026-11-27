"""
scripts/carry_over_deployments.py, which turns the deployments of before
phase 2 into statements once per server. Each test starts as such a server
left a camera: deployment rows with photos linked to them. After the
carry-over the dates, sites, numbers and photo links must be exactly as
before, for every kind of history found on the production servers.
"""
import importlib.util
import os
from datetime import datetime

import pytest
from sqlalchemy.orm import Session

from shared.database import engine

from deployment_db import (
    HOME, at, day, deployments, execute, history, make_camera, make_deployment, make_image,
    make_project, make_site, offset, rows,
)

# A script, not a module on the path: loaded from its file.
_spec = importlib.util.spec_from_file_location(
    "carry_over_deployments",
    os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "carry_over_deployments.py"),
)
carry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(carry)

FAR = offset(HOME, east_m=1500)


def run(camera_id, retired_at=None):
    with Session(engine) as session:
        result = carry.carry_over_camera(session, camera_id, "CAM", retired_at)
        session.commit()
    return result


def links(camera_id):
    return {r["id"]: r["deployment_id"] for r in rows("SELECT id, deployment_id FROM images WHERE camera_id = :c", c=camera_id)}


def snapshot(camera_id):
    return [(r["number"], r["site_id"], r["start_date"], r["end_date"]) for r in deployments(camera_id)], links(camera_id)


@pytest.fixture
def place():
    project = make_project()
    return project, make_site(project, "Home", HOME), make_site(project, "Far", FAR)


def test_a_clean_gps_history_stays_automatic(place):
    project, home, far = place
    cam = make_camera("CLEAN", project)
    first = make_deployment(cam, 1, home, day(1), day(9), HOME)
    second = make_deployment(cam, 2, far, day(10), None, FAR)
    for n, dep, gps in [(1, first, HOME), (2, first, HOME), (10, second, FAR), (11, second, FAR)]:
        make_image(cam, dep, at(n), gps)
    before = snapshot(cam)

    result = run(cam)

    assert not result.pinned and result.exceptions == []
    assert snapshot(cam) == before
    assert rows("SELECT * FROM deployment_statements") == []
    # The rebuild made the times exact.
    assert deployments(cam)[1]["start_at"] == at(10)


def test_a_hand_set_site_is_pinned(place):
    """Same dates as the GPS gives, but a person chose the site."""
    project, home, far = place
    other = make_site(project, "Other", offset(HOME, north_m=4000))
    cam = make_camera("HAND", project)
    dep = make_deployment(cam, 1, other, day(1), None, HOME, site_source="manual")
    make_image(cam, dep, at(1), HOME)
    make_image(cam, dep, at(2), HOME)
    before = snapshot(cam)

    result = run(cam)

    assert result.pinned and result.statements == 1 and result.exceptions == []
    assert snapshot(cam) == before
    [s] = rows("SELECT * FROM deployment_statements")
    assert (s["source"], s["site_id"], s["until_at"], s["fixed_until_at"]) == ("carried_over", other, None, at(2))


def test_an_upload_to_a_site_without_gps_is_pinned(place):
    project, home, far = place
    cam = make_camera("UPLOAD", project)
    upload = make_deployment(cam, 2, far, day(1), day(5), FAR)
    live = make_deployment(cam, 1, home, day(20), None, HOME)
    make_image(cam, upload, at(2))
    make_image(cam, upload, at(4))
    make_image(cam, live, at(20), HOME)
    make_image(cam, live, at(21), HOME)
    before = snapshot(cam)

    result = run(cam)

    assert result.pinned and result.statements == 2 and result.exceptions == []
    assert snapshot(cam) == before


def test_a_split_by_an_older_rule_is_kept(place):
    """The old 100 m rule split at 150 m. Today's rule would make one."""
    project, home, far = place
    near = make_site(project, "Near", offset(HOME, east_m=150))
    cam = make_camera("OLD", project)
    first = make_deployment(cam, 1, home, day(1), day(4), HOME)
    second = make_deployment(cam, 2, near, day(5), None, offset(HOME, east_m=150))
    make_image(cam, first, at(1), HOME)
    make_image(cam, second, at(5), offset(HOME, east_m=150))
    make_image(cam, second, at(6), offset(HOME, east_m=150))
    before = snapshot(cam)

    result = run(cam)

    assert result.pinned and result.exceptions == []
    assert snapshot(cam) == before


def test_a_deployment_a_report_opened_keeps_its_start(place):
    project, home, far = place
    cam = make_camera("REPORT", project)
    dep = make_deployment(cam, 1, home, day(1), None, HOME)
    make_image(cam, dep, at(3), HOME)
    before = snapshot(cam)

    result = run(cam)

    assert result.pinned and result.exceptions == []
    assert snapshot(cam) == before


def test_a_retired_camera_stays_closed(place):
    project, home, far = place
    cam = make_camera("RETIRED", project)
    execute("UPDATE cameras SET retired_at = now(), project_id = :p WHERE id = :c", p=project, c=cam)
    dep = make_deployment(cam, 1, home, day(1), day(3), HOME)
    make_image(cam, dep, at(1), HOME)
    make_image(cam, dep, at(3), HOME)
    before = snapshot(cam)

    result = run(cam, retired_at=datetime(2026, 4, 1))

    assert not result.pinned and result.exceptions == []
    assert snapshot(cam) == before


def test_after_the_carry_over_the_gps_rule_goes_on(place):
    """A pinned camera is not locked: two far photos after its newest photo
    still make a move."""
    project, home, far = place
    other = make_site(project, "Other", offset(HOME, north_m=4000))
    cam = make_camera("HAND", project)
    dep = make_deployment(cam, 1, other, day(1), None, HOME, site_source="manual")
    make_image(cam, dep, at(1), HOME)
    run(cam)

    history(cam, [(FAR, at(10)), (FAR, at(11))])

    assert [x["site_id"] for x in deployments(cam)] == [other, far]


def test_the_gate_names_what_changed():
    before = [carry.Row(1, 1, 7, day(1), day(9)), carry.Row(2, 2, 8, day(10), None)]
    after = [carry.Row(1, 1, 7, day(1), None)]
    found = carry.gate(before, after, {10: 1, 11: 2}, {10: 1, 11: 1})
    assert found == [
        "deployment 1: site 7, 2026-03-01 to 2026-03-09 became site 7, 2026-03-01 to None",
        "deployment 2 is gone: 2026-03-10 to None",
        "1 photo(s) on another deployment, first id 11",
    ]


def test_photos_on_the_morning_of_a_move_go_to_the_new_deployment(place):
    """spw camera 861943072868440. Stored deployments only know days, so a
    photo at the old place early on the day of a move lands on the new
    deployment. Accepted: the dates stay the same, and the rule explains it."""
    project, home, far = place
    cam = make_camera("MORNING", project)
    first = make_deployment(cam, 1, home, day(1), day(12), HOME, site_source="manual")
    second = make_deployment(cam, 2, far, day(13), None, FAR, site_source="manual")
    make_image(cam, first, at(10), HOME)
    morning = make_image(cam, first, datetime(2026, 3, 13, 1, 37), HOME)
    make_image(cam, second, datetime(2026, 3, 13, 15, 0), FAR)
    make_image(cam, second, at(14), FAR)
    dates_before = snapshot(cam)[0]

    result = run(cam)

    assert snapshot(cam)[0] == dates_before
    assert result.exceptions == ["1 photo(s) on another deployment, first id " + str(
        rows("SELECT id FROM images WHERE uuid = :u", u=morning)[0]["id"])]
