"""
Rebuild one camera's deployments and write them.

rebuild_camera is the only code that writes the deployments table and
images.deployment_id. Call it after anything that can change a camera's
history: a new photo, a deleted photo, a new or removed statement. It reads
all readings and statements of the camera, builds the deployments
(shared/deployment_build.py) and brings the rows in line. Running it twice
changes nothing.

The steps between the build and the writes are plain functions (match_rows,
join_same_site, link_photos), so they are tested without a database.
"""
import uuid
from collections import Counter
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Optional, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from .deployment_build import BuiltDeployment, Reading, Statement, build_deployments
from .geo import RECOMPUTE_SITE_LOCATION_SQL, SITE_THRESHOLD_METERS, auto_site_name, combine_pins
from .logger import get_logger

logger = get_logger("deployment-rebuild")

# First key of the advisory lock that keeps two rebuilds of one camera apart.
# The second key is the camera id. Any fixed number works, as long as no other
# advisory lock in the app uses it.
LOCK_NAMESPACE = 20261119

# Two deployments in a row at the same site are one deployment when the later
# one starts no more than this many days after the earlier one ends. A real
# removal and return leaves a longer gap and stays two deployments.
SAME_SITE_GAP_DAYS = 1


@dataclass(frozen=True)
class Photo:
    id: int
    taken_at: datetime
    lat: Optional[float]
    lon: Optional[float]
    deployment_id: Optional[int]


@dataclass(frozen=True)
class StoredRow:
    id: int
    number: int
    site_id: Optional[int]
    start_at: datetime
    end_at: Optional[datetime]
    lat: float
    lon: float
    reading_count: int
    site_source: str = "auto"

    @property
    def start_date(self):
        return self.start_at.date()


@dataclass
class Planned:
    """A built deployment on its way to a row."""
    built: BuiltDeployment
    row_id: Optional[int]  # the stored row it keeps, None = a new row
    site_id: Optional[int] = None
    site_created: bool = False


@dataclass(frozen=True)
class RebuildResult:
    created: tuple[int, ...]  # ids of new deployment rows
    deleted: int


# Plain steps


def match_rows(built: Sequence[BuiltDeployment], stored: Sequence[StoredRow],
               photos: Sequence[Photo]) -> list[Optional[int]]:
    """For each built deployment the stored row it continues, or None. A row
    goes to the built deployment that holds most of the photos now on it,
    else to one that starts on the same day. Keeping rows keeps their id,
    their number and the site the app once picked."""
    on_row = {p.id: p.deployment_id for p in photos}
    row_ids = {s.id for s in stored}
    shared: list[tuple[int, int, int]] = []
    for index, b in enumerate(built):
        votes = Counter(on_row.get(i) for i in b.image_ids)
        shared.extend((n, index, row) for row, n in votes.items() if row in row_ids)

    result: list[Optional[int]] = [None] * len(built)
    taken: set[int] = set()
    # Most shared photos first; oldest deployment first on a tie.
    for _, index, row in sorted(shared, key=lambda t: (-t[0], t[1], t[2])):
        if result[index] is None and row not in taken:
            result[index] = row
            taken.add(row)
    for index, b in enumerate(built):
        if result[index] is not None:
            continue
        for s in stored:
            if s.id not in taken and s.start_date == b.start_date:
                result[index] = s.id
                taken.add(s.id)
                break
    return result


def join_same_site(planned: Sequence[Planned]) -> list[Planned]:
    """Two deployments in a row at the same site become one. The earlier one
    carries on with its row and its start. Its pin becomes the mean of the
    readings of both."""
    joined: list[Planned] = []
    for p in planned:
        last = joined[-1] if joined else None
        if (
            last is not None
            and last.site_id is not None
            and last.site_id == p.site_id
            and last.built.end_date is not None
            and p.built.start_date <= last.built.end_date + timedelta(days=SAME_SITE_GAP_DAYS)
        ):
            a, b = last.built, p.built
            if a.lat is None or b.lat is None:
                lat, lon, n = (a.lat, a.lon, a.reading_count) if b.lat is None else (b.lat, b.lon, b.reading_count)
            else:
                lat, lon, n = combine_pins(a.lat, a.lon, a.reading_count, b.lat, b.lon, b.reading_count)
            last.built = replace(
                a, end_at=b.end_at, lat=lat, lon=lon, reading_count=n,
                image_ids=a.image_ids + b.image_ids,
            )
            if last.row_id is None:
                last.row_id = p.row_id
            last.site_created = last.site_created or p.site_created
        else:
            joined.append(p)
    return joined


def link_photos(deployments: Sequence[BuiltDeployment], photos: Sequence[Photo]) -> dict[int, Optional[int]]:
    """Photo id to the index of its deployment, None when no deployment covers
    it. A photo with a reading follows the build. A photo without one belongs
    to the deployment that covers its capture time."""
    by_build = {image_id: index for index, d in enumerate(deployments) for image_id in d.image_ids}
    links: dict[int, Optional[int]] = {}
    for p in photos:
        if p.id in by_build:
            links[p.id] = by_build[p.id]
            continue
        links[p.id] = next(
            (
                index for index, d in enumerate(deployments)
                if d.start_at <= p.taken_at and (d.end_at is None or p.taken_at < d.end_at)
            ),
            None,
        )
    return links


# The database


def rebuild_camera(session: Session, camera_id: int) -> RebuildResult:
    """
    Bring the deployments of one camera in line with its readings and
    statements. Does not commit: the caller's transaction decides, so a photo
    and the rebuild it causes are saved together or not at all.

    A new deployment row starts unchecked (checked_at NULL). If the GPS made
    it, it shows in the moves check as an update nobody answered until a person
    says it is right. A kept row keeps its mark.

    Raises:
        ValueError: unknown camera.
    """
    # One rebuild per camera at a time, until this transaction ends. Ingestion
    # has two threads and the bulk worker and the API run next to it.
    session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :camera_id)"),
        {"namespace": LOCK_NAMESPACE, "camera_id": camera_id},
    )

    camera = session.execute(
        text("SELECT project_id, retired_at FROM cameras WHERE id = :id"), {"id": camera_id},
    ).first()
    if camera is None:
        raise ValueError(f"Unknown camera {camera_id}")

    photos, statements = load_history(session, camera_id)
    stored = [
        StoredRow(r.id, r.deployment_number, r.site_id, r.start_at, r.end_at, r.lat, r.lon,
                  r.gps_reading_count, r.site_source)
        for r in session.execute(text("""
            SELECT id, deployment_number, site_id, start_at, end_at, gps_reading_count, site_source,
                   ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
            FROM deployments WHERE camera_id = :id ORDER BY deployment_number
        """), {"id": camera_id})
    ]

    built = build_history(photos, statements, camera.retired_at)

    stored_by_id = {s.id: s for s in stored}
    planned: list[Planned] = []
    for b, row_id in zip(built, match_rows(built, stored, photos)):
        p = Planned(b, row_id)
        # A GPS part keeps the site its row had, so jitter never hops it to
        # another site. Only a site the GPS chose, though: a site a person
        # set came from a statement, and once that statement is removed the
        # GPS decides again. Keeping it made Undo of "It stayed at Pond"
        # leave the camera at Pond (Peter's walkthrough, 21 November 2026).
        old = stored_by_id[row_id] if row_id is not None else None
        kept_site = old.site_id if old is not None and old.site_source == "auto" else None
        if b.site_id is not None:
            p.site_id = b.site_id
        elif kept_site is not None:
            p.site_id = kept_site
        elif camera.project_id is not None and b.lat is not None:
            p.site_id, p.site_created = _nearest_or_new_site(session, camera.project_id, b.lat, b.lon)
        planned.append(p)
    planned = join_same_site(planned)

    next_number = max((s.number for s in stored), default=0) + 1
    touched_sites: set[int] = set()
    created: list[int] = []
    for index, p in enumerate(planned):
        b = p.built
        lat, lon = (b.lat, b.lon) if b.lat is not None else _site_pin(session, p.site_id)
        values = {
            # 'manual' marks a deployment a statement made, 'auto' one the GPS made.
            "source": "manual" if b.statement_id is not None else "auto",
            "site_id": p.site_id,
            "start_at": b.start_at, "end_at": b.end_at,
            "start_date": b.start_date, "end_date": b.end_date,
            "wkt": f"POINT({lon} {lat})", "n": b.reading_count,
        }
        old = stored_by_id.get(p.row_id) if p.row_id is not None else None
        if old is None:
            p.row_id = session.execute(text("""
                INSERT INTO deployments (
                    camera_id, deployment_number, site_id, site_source,
                    start_at, end_at, start_date, end_date, location, gps_reading_count
                ) VALUES (
                    :camera_id, :number, :site_id, :source,
                    :start_at, :end_at, :start_date, :end_date, ST_GeogFromText(:wkt), :n
                ) RETURNING id
            """), {**values, "camera_id": camera_id, "number": next_number}).scalar_one()
            next_number += 1
            created.append(p.row_id)
            touched_sites.add(p.site_id)
        elif _differs(old, p, lat, lon, values["source"]):
            session.execute(text("""
                UPDATE deployments
                SET site_id = :site_id, site_source = :source, start_at = :start_at, end_at = :end_at,
                    start_date = :start_date, end_date = :end_date,
                    location = ST_GeogFromText(:wkt), gps_reading_count = :n
                WHERE id = :id
            """), {**values, "id": p.row_id})
            touched_sites.update({old.site_id, p.site_id})

    # Photos first, rows after: a photo must never point at a row that goes.
    links = link_photos([p.built for p in planned], photos)
    changed: dict[Optional[int], list[int]] = {}
    for photo in photos:
        index = links[photo.id]
        row_id = planned[index].row_id if index is not None else None
        if row_id != photo.deployment_id:
            changed.setdefault(row_id, []).append(photo.id)
    for row_id, ids in changed.items():
        session.execute(
            text("UPDATE images SET deployment_id = :row_id WHERE id = ANY(:ids)"),
            {"row_id": row_id, "ids": ids},
        )

    kept = {p.row_id for p in planned}
    gone = [s for s in stored if s.id not in kept]
    if gone:
        session.execute(
            text("DELETE FROM deployments WHERE id = ANY(:ids)"), {"ids": [s.id for s in gone]},
        )
        touched_sites.update(s.site_id for s in gone)

    # The newest photo per deployment, which ends the effort of an open one
    # (shared/effort.py). Only rows whose value changes are written.
    session.execute(text("""
        UPDATE deployments d
        SET last_photo_at = m.last
        FROM (
            SELECT d2.id, (SELECT max(i.captured_at) FROM images i WHERE i.deployment_id = d2.id) AS last
            FROM deployments d2 WHERE d2.camera_id = :camera_id
        ) m
        WHERE d.id = m.id AND d.last_photo_at IS DISTINCT FROM m.last
    """), {"camera_id": camera_id})

    session.flush()
    for site_id in touched_sites - {None}:
        session.execute(text(RECOMPUTE_SITE_LOCATION_SQL), {"site_id": site_id})

    if created or gone:
        logger.info(
            "Rebuilt deployments", camera_id=camera_id,
            deployments=len(planned), created=len(created), deleted=len(gone),
        )
    return RebuildResult(tuple(created), len(gone))


def load_history(session: Session, camera_id: int) -> tuple[list[Photo], list[Statement]]:
    """Everything the build reads for one camera: its photos in capture order
    and its statements in force."""
    photos = [
        Photo(r.id, r.captured_at, r.gps_lat, r.gps_lon, r.deployment_id)
        for r in session.execute(text("""
            SELECT id, captured_at, gps_lat, gps_lon, deployment_id
            FROM images WHERE camera_id = :id ORDER BY captured_at, id
        """), {"id": camera_id})
    ]
    statements = [
        Statement(r.id, r.site_id, r.from_at, r.until_at, r.fixed_until_at)
        for r in session.execute(text("""
            SELECT id, site_id, from_at, until_at, fixed_until_at
            FROM deployment_statements
            WHERE camera_id = :id AND removed_at IS NULL ORDER BY id
        """), {"id": camera_id})
    ]
    return photos, statements


def build_history(photos: Sequence[Photo], statements: Sequence[Statement],
                  retired_at: Optional[datetime]) -> list[BuiltDeployment]:
    """The build as the rebuild runs it: readings are the photos with GPS."""
    return build_deployments(
        [Reading(p.id, p.taken_at, p.lat, p.lon) for p in photos if p.lat is not None],
        statements,
        closed_at=_closed_at(retired_at, photos),
    )


def _closed_at(retired_at: Optional[datetime], photos: Sequence[Photo]) -> Optional[datetime]:
    """Where a retired camera's history ends: the end of the day of its last
    photo, so the project stops counting trap days for a camera that left. A
    camera that never sent a photo ends on the day it was retired."""
    if retired_at is None:
        return None
    last = max(p.taken_at for p in photos).date() if photos else retired_at.date()
    return datetime.combine(last + timedelta(days=1), datetime.min.time())


def _differs(old: StoredRow, p: Planned, lat: float, lon: float, source: str) -> bool:
    b = p.built
    return (
        old.site_id != p.site_id
        or old.site_source != source
        or old.start_at != b.start_at
        or old.end_at != b.end_at
        or old.reading_count != b.reading_count
        or (old.lat, old.lon) != (lat, lon)
    )


def _site_pin(session: Session, site_id: Optional[int]) -> tuple[float, float]:
    """The pin of a stated site, for a stated deployment without readings."""
    row = session.execute(text("""
        SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
        FROM sites WHERE id = :id
    """), {"id": site_id}).first()
    if row is None:
        raise ValueError(f"Site {site_id} not found")
    return row.lat, row.lon


def _nearest_or_new_site(session: Session, project_id: int, lat: float, lon: float) -> tuple[int, bool]:
    """(site id, created) for a deployment that GPS made: the nearest site of
    the project within SITE_THRESHOLD_METERS, else a new site named from the
    coordinates. Plain nearest site, no memory per camera: fieldworkers take
    cameras from the truck at random, so a camera's previous site says nothing
    about its next one. A person corrects it afterwards where needed."""
    wkt = f"POINT({lon} {lat})"
    nearest = session.execute(text("""
        SELECT id, ST_Distance(location, ST_GeogFromText(:wkt)) AS dist
        FROM sites WHERE project_id = :project_id ORDER BY dist LIMIT 1
    """), {"wkt": wkt, "project_id": project_id}).first()
    if nearest is not None and nearest.dist <= SITE_THRESHOLD_METERS:
        return nearest.id, False

    site_id = session.execute(text("""
        INSERT INTO sites (uuid, project_id, name, location, created_at)
        VALUES (:uuid, :project_id, :name, ST_GeogFromText(:wkt), now())
        RETURNING id
    """), {
        "uuid": str(uuid.uuid4()), "project_id": project_id,
        "name": auto_site_name(lat, lon), "wkt": wkt,
    }).scalar_one()
    logger.info("Auto-created site", site_id=site_id, project_id=project_id)
    return site_id, True
