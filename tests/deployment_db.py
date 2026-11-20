"""
Shared helpers for the database tests in tests/db_ingestion and tests/db_api.

These tests run the deployment code (shared/deployment_rebuild.py and the
routes that write statements) against a real PostGIS, because the rules live
in SQL as much as in Python. Run them with scripts/test-db.sh, which starts a
throwaway database. CI runs them in the db job of .github/workflows/tests.yml.

use_test_database() must run before anything imports shared.database: it
points DATABASE_URL at the throwaway database, and refuses any other, because
every test empties the tables.
"""
import math
import os
import uuid
from datetime import date, datetime
from typing import Optional

import pytest

TEST_DATABASE_NAME = "deployment_tests"


def use_test_database() -> None:
    url = os.environ.get("DEPLOYMENT_TEST_DATABASE_URL", "")
    if not url.rsplit("/", 1)[-1] == TEST_DATABASE_NAME:
        raise RuntimeError(
            "These tests need the throwaway database. Run them with scripts/test-db.sh "
            f"(DEPLOYMENT_TEST_DATABASE_URL must end in /{TEST_DATABASE_NAME}, got {url!r})."
        )
    os.environ["DATABASE_URL"] = url


use_test_database()

from sqlalchemy import text  # noqa: E402
from shared.database import engine  # noqa: E402


@pytest.fixture(autouse=True)
def empty_tables():
    """Every test starts from an empty project space. CASCADE takes every
    table that points at these (deployments, statements, images, feed
    entries, health reports, memberships). server_settings stays, as the
    migrations made it."""
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE projects, cameras, users, sites RESTART IDENTITY CASCADE"))
    yield


# A quiet spot on Griend in the Wadden Sea, the same area dev_simulate_feed.py uses.
HOME = (53.2600, 5.1800)
DAY = date(2026, 3, 1)


def offset(point: tuple[float, float], east_m: float = 0.0, north_m: float = 0.0) -> tuple[float, float]:
    """A point east_m east and north_m north of point. Good to well under a
    metre at these distances, which is all the 250 m rule needs."""
    lat, lon = point
    return (
        lat + north_m / 111_320.0,
        lon + east_m / (111_320.0 * math.cos(math.radians(lat))),
    )


def at(day: int, hour: int = 12, second: int = 0) -> datetime:
    """Camera clock time on day `day` of March 2026."""
    return datetime(2026, 3, day, hour, 0, second)


def rows(sql: str, **params) -> list:
    with engine.connect() as conn:
        return list(conn.execute(text(sql), params).mappings())


def scalar(sql: str, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def execute(sql: str, **params):
    with engine.begin() as conn:
        result = conn.execute(text(sql), params)
        return result.scalar() if result.returns_rows else None


def make_project(name: str = "Griend") -> int:
    return execute(
        "INSERT INTO projects (name, classification_model) VALUES (:n, 'speciesnet') RETURNING id",
        n=name,
    )


def make_camera(device_id: str, project_id: Optional[int]) -> int:
    return execute(
        "INSERT INTO cameras (device_id, project_id) VALUES (:d, :p) RETURNING id",
        d=device_id, p=project_id,
    )


def make_user(email: str = "admin@example.org") -> int:
    return execute(
        """INSERT INTO users (email, hashed_password, is_active, is_superuser, is_verified)
           VALUES (:e, 'x', true, true, true) RETURNING id""",
        e=email,
    )


def make_site(project_id: int, name: str, point: tuple[float, float]) -> int:
    return execute(
        """INSERT INTO sites (uuid, project_id, name, location)
           VALUES (:u, :p, :n, ST_GeogFromText(:wkt)) RETURNING id""",
        u=str(uuid.uuid4()), p=project_id, n=name, wkt=f"POINT({point[1]} {point[0]})",
    )


def make_deployment(
    camera_id: int, number: int, site_id: Optional[int], start: date,
    end: Optional[date], point: tuple[float, float], site_source: str = "auto",
) -> int:
    return execute(
        """INSERT INTO deployments
             (camera_id, deployment_number, site_id, site_source,
              start_at, end_at, start_date, end_date, location)
           VALUES (:c, :n, :s, :src, CAST(:start AS timestamp),
                   CAST(CAST(:end AS date) + 1 AS timestamp), :start, :end, ST_GeogFromText(:wkt))
           RETURNING id""",
        c=camera_id, n=number, s=site_id, src=site_source, start=start, end=end,
        wkt=f"POINT({point[1]} {point[0]})",
    )


def make_statement(camera_id: int, site_id: int, from_at: datetime,
                   until_at: Optional[datetime] = None, source: str = "person",
                   fixed_until_at: Optional[datetime] = None) -> int:
    return execute(
        """INSERT INTO deployment_statements (camera_id, site_id, from_at, until_at, fixed_until_at, source)
           VALUES (:c, :s, :f, :u, :fx, :src) RETURNING id""",
        c=camera_id, s=site_id, f=from_at, u=until_at, fx=fixed_until_at, src=source,
    )


def make_image(camera_id: int, deployment_id: Optional[int], captured_at: datetime,
               gps: Optional[tuple[float, float]] = None) -> str:
    image_uuid = str(uuid.uuid4())
    execute(
        """INSERT INTO images (uuid, filename, camera_id, captured_at, storage_path, status,
                               deployment_id, gps_lat, gps_lon)
           VALUES (:u, 'x.jpg', :c, :t, 'x', 'classified', :d, :lat, :lon)""",
        u=image_uuid, c=camera_id, t=captured_at, d=deployment_id,
        lat=gps[0] if gps else None, lon=gps[1] if gps else None,
    )
    return image_uuid


def make_feed_event(
    project_id: int, camera_id: int, event_type: str, deployment_id: int,
    site_id: Optional[int], site_created: bool, from_site_id: Optional[int] = None,
) -> int:
    return execute(
        """INSERT INTO feed_events
             (project_id, camera_id, event_type, deployment_id, site_id, site_created, from_site_id)
           VALUES (:p, :c, :t, :d, :s, :sc, :f) RETURNING id""",
        p=project_id, c=camera_id, t=event_type, d=deployment_id, s=site_id,
        sc=site_created, f=from_site_id,
    )


def deployments(camera_id: int) -> list:
    """The camera's deployments in time order, with the pin as lat and lon.
    Numbers are given once and never reshuffled, so after an old SD card
    they do not follow time."""
    return rows(
        """SELECT id, deployment_number AS number, site_id, site_source,
                  start_at, end_at, start_date, end_date, gps_reading_count AS readings,
                  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
           FROM deployments WHERE camera_id = :c ORDER BY start_at, deployment_number""",
        c=camera_id,
    )


def sites(project_id: int) -> list:
    return rows(
        """SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
           FROM sites WHERE project_id = :p ORDER BY id""",
        p=project_id,
    )


def site(site_id: int):
    found = rows(
        """SELECT id, name, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
           FROM sites WHERE id = :s""",
        s=site_id,
    )
    return found[0] if found else None


def feed(camera_id: int) -> list:
    return rows("SELECT * FROM feed_events WHERE camera_id = :c ORDER BY id", c=camera_id)


def image_deployment(image_uuid: str) -> Optional[int]:
    return scalar("SELECT deployment_id FROM images WHERE uuid = :u", u=image_uuid)


def camera_config(camera_id: int) -> dict:
    return scalar("SELECT config FROM cameras WHERE id = :c", c=camera_id) or {}


def close(a: float, b: float, metres: float = 0.5) -> bool:
    """Two latitudes or longitudes within about `metres` of each other."""
    return abs(a - b) < metres / 111_320.0
