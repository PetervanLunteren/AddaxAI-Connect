"""
Step 2c: one rule for the current site, and the last photo that ends effort.

The current deployment is the one that started last (shared/deployment_queries.py),
given as SQL text and as a SQLAlchemy expression. Both must say the same, also
after an old SD card gave an older deployment a higher number.
"""
from datetime import datetime

import pytest
from sqlalchemy import select, text

from deployment_db import (
    at, deployments, HOME, make_camera, make_image, make_project, make_site, offset, rebuild, rows,
)
from shared.database import engine
from shared.deployment_queries import CURRENT_DEPLOYMENTS_SQL, current_deployments

FAR = offset(HOME, east_m=5000)


def both_rules():
    with engine.connect() as conn:
        by_text = {r.camera_id: r.site_id for r in conn.execute(text(CURRENT_DEPLOYMENTS_SQL))}
        current = current_deployments()
        by_core = {r.camera_id: r.site_id for r in conn.execute(select(current.c.camera_id, current.c.site_id))}
    return by_text, by_core


@pytest.fixture
def sd_card_camera():
    """Live at Home from day 20, then an old SD card from Far, days 2 and 3.
    The card's deployment is older in time but got the higher number."""
    project = make_project()
    home = make_site(project, "Home", HOME)
    far = make_site(project, "Far", FAR)
    cam = make_camera("SD01", project)
    make_image(cam, None, at(20), HOME)
    make_image(cam, None, at(21), HOME)
    rebuild(cam)
    make_image(cam, None, at(2), FAR)
    make_image(cam, None, at(3), FAR)
    rebuild(cam)
    return cam, home, far


def test_the_current_site_follows_time_not_the_number(sd_card_camera):
    cam, home, far = sd_card_camera
    numbers = {d["site_id"]: d["number"] for d in deployments(cam)}
    assert numbers[far] > numbers[home]  # the card came later

    by_text, by_core = both_rules()
    assert by_text[cam] == by_core[cam] == home


def test_a_retired_camera_keeps_its_last_site():
    project = make_project()
    home = make_site(project, "Home", HOME)
    cam = make_camera("OLD", project)
    make_image(cam, None, at(2), HOME)
    with engine.begin() as conn:
        conn.execute(text("UPDATE cameras SET retired_at = now() WHERE id = :c"), {"c": cam})
    rebuild(cam)

    [dep] = deployments(cam)
    assert dep["end_at"] is not None
    by_text, by_core = both_rules()
    assert by_text[cam] == by_core[cam] == home


def test_the_rebuild_keeps_the_last_photo_of_each_deployment(sd_card_camera):
    cam, home, far = sd_card_camera
    last = {r["site_id"]: r["last_photo_at"] for r in rows(
        "SELECT site_id, last_photo_at FROM deployments WHERE camera_id = :c", c=cam)}
    assert last == {far: at(3), home: at(21)}

    make_image(cam, None, datetime(2026, 3, 25, 6, 0), HOME)
    rebuild(cam)
    [home_last] = rows("SELECT last_photo_at FROM deployments WHERE camera_id = :c AND site_id = :s", c=cam, s=home)
    assert home_last["last_photo_at"] == datetime(2026, 3, 25, 6, 0)
