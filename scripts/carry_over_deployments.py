"""
Carry the deployments from before phase 2 over to statements, once per server.

Step 2a of DEPLOYMENTS_PLAN.md. From phase 2 on, deployments are rebuilt from
the GPS readings of photos plus statements. History made by older rules, by
hand corrections, by uploads to a chosen site or by daily reports does not
follow from the readings alone. So, per camera:

1. Build the deployments from the readings, as the rebuild would.
2. The same as stored (dates and which deployment every photo is on): the
   camera stays automatic, nothing is written.
3. Different: every stored deployment becomes a statement ('carried_over'),
   so the rebuild gives back exactly what was stored. The last, open one
   covers up to the camera's newest photo, and after that the GPS rule
   carries on as for any camera.
4. Rebuild the camera, and check the result against what was stored before.

Run by scripts/update-database.sh after the migrations:

    docker compose exec -T api python /app/scripts/carry_over_deployments.py           # dry run
    docker compose exec -T api python /app/scripts/carry_over_deployments.py --apply   # write

The dry run does all of it and rolls back, so its report is exactly what
--apply would give. --apply runs once: it sets
server_settings.deployments_carried_over_at and does nothing the next time.

The report also goes to REPORT_PATH in the api container, because
restore.sh runs update-database.sh without output. Read it with
`docker compose exec -T api cat /tmp/carry-over-deployments.txt`.
"""
import argparse
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Optional

sys.path.insert(0, '/app')

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from shared.config import get_settings  # noqa: E402
from shared.deployment_build import Reading, build_deployments  # noqa: E402
from shared.deployment_rebuild import LOCK_NAMESPACE, _closed_at, link_photos, rebuild_camera  # noqa: E402
from shared.deployment_rebuild import Photo as RebuildPhoto  # noqa: E402
from shared.geo import calculate_gps_distance  # noqa: E402
from shared.logger import get_logger  # noqa: E402

logger = get_logger("carry-over-deployments")

# A site pin that moves further than this in the carry-over is listed.
PIN_REPORT_METRES = 10.0

REPORT_PATH = "/tmp/carry-over-deployments.txt"


@dataclass(frozen=True)
class Row:
    """A stored deployment, as the gate compares it."""
    id: int
    number: int
    site_id: Optional[int]
    start_date: date
    end_date: Optional[date]


@dataclass(frozen=True)
class Stored:
    id: int
    number: int
    site_id: Optional[int]
    start_at: datetime
    end_at: Optional[datetime]
    start_date: date
    end_date: Optional[date]
    site_source: str = "auto"


@dataclass
class CameraResult:
    camera_id: int
    device_id: str
    pinned: bool = False
    statements: int = 0
    skipped_without_site: int = 0
    exceptions: list[str] = field(default_factory=list)


# Plain parts


def history_is_rebuilt(stored: list[Stored], photos: list[RebuildPhoto],
                       retired_at: Optional[datetime]) -> bool:
    """Whether the readings alone give back the stored history: the same
    number of deployments with the same dates, and every photo on the same
    one. Pins are not compared: a pin a few metres off changes no number. A
    site a person chose ('manual') is never left to the GPS: without a
    statement behind it, the choice would last only as long as its row."""
    if any(s.site_source == "manual" for s in stored):
        return False
    readings = [Reading(p.id, p.taken_at, p.lat, p.lon) for p in photos if p.lat is not None]
    built = build_deployments(readings, closed_at=_closed_at(retired_at, photos))
    in_time = sorted(stored, key=lambda s: (s.start_at, s.number))
    if [(b.start_date, b.end_date) for b in built] != [(s.start_date, s.end_date) for s in in_time]:
        return False
    position = {s.id: i for i, s in enumerate(in_time)}
    links = link_photos(built, photos)
    return all(links[p.id] == position.get(p.deployment_id) for p in photos)


def statements_for(stored: list[Stored], photos: list[RebuildPhoto]) -> list[dict]:
    """One statement per stored deployment, with exactly its days. The open
    one is fixed up to its newest photo, after that the GPS carries on as for
    any camera. A deployment without a site cannot be stated and is left to
    the GPS.

    Stored deployments only know days, so on the day of a move every photo
    goes to the new deployment, also one taken at the old place that morning.
    Two deployments that share a day: the later one wins that day."""
    newest_photo: dict[int, datetime] = {}
    for p in photos:
        if p.deployment_id is not None:
            newest_photo[p.deployment_id] = max(newest_photo.get(p.deployment_id, p.taken_at), p.taken_at)
    return [
        {
            "site_id": s.site_id,
            "from_at": s.start_at,
            "until_at": s.end_at,
            "fixed_until_at": newest_photo.get(s.id, s.start_at) if s.end_at is None else None,
        }
        for s in sorted(stored, key=lambda s: (s.start_at, s.number))
        if s.site_id is not None
    ]


def gate(before: list[Row], after: list[Row], links_before: dict[int, Optional[int]],
         links_after: dict[int, Optional[int]]) -> list[str]:
    """Every way the history after the carry-over differs from before."""
    found = []
    old = {r.number: r for r in before}
    new = {r.number: r for r in after}
    for number in sorted(old.keys() | new.keys()):
        a, b = old.get(number), new.get(number)
        if a is None:
            found.append(f"deployment {number} is new: {b.start_date} to {b.end_date}")
        elif b is None:
            found.append(f"deployment {number} is gone: {a.start_date} to {a.end_date}")
        elif (a.site_id, a.start_date, a.end_date) != (b.site_id, b.start_date, b.end_date):
            found.append(
                f"deployment {number}: site {a.site_id}, {a.start_date} to {a.end_date} "
                f"became site {b.site_id}, {b.start_date} to {b.end_date}"
            )
    number_of = {r.id: r.number for r in before} | {r.id: r.number for r in after}
    moved = [
        image_id for image_id, dep in links_before.items()
        if number_of.get(dep) != number_of.get(links_after.get(image_id))
    ]
    if moved:
        found.append(f"{len(moved)} photo(s) on another deployment, first id {moved[0]}")
    return found


# The database


def load(session: Session, camera_id: int):
    stored = [
        Stored(r.id, r.deployment_number, r.site_id, r.start_at, r.end_at, r.start_date, r.end_date,
               r.site_source)
        for r in session.execute(text("""
            SELECT id, deployment_number, site_id, start_at, end_at, start_date, end_date, site_source
            FROM deployments WHERE camera_id = :c
        """), {"c": camera_id})
    ]
    photos = [
        RebuildPhoto(r.id, r.captured_at, r.gps_lat, r.gps_lon, r.deployment_id)
        for r in session.execute(text("""
            SELECT id, captured_at, gps_lat, gps_lon, deployment_id
            FROM images WHERE camera_id = :c ORDER BY captured_at, id
        """), {"c": camera_id})
    ]
    return stored, photos


def rows_of(stored: list[Stored]) -> list[Row]:
    return [Row(s.id, s.number, s.site_id, s.start_date, s.end_date) for s in stored]


def carry_over_camera(session: Session, camera_id: int, device_id: str,
                      retired_at: Optional[datetime]) -> CameraResult:
    result = CameraResult(camera_id, device_id)
    session.execute(
        text("SELECT pg_advisory_xact_lock(:namespace, :camera_id)"),
        {"namespace": LOCK_NAMESPACE, "camera_id": camera_id},
    )
    stored, photos = load(session, camera_id)
    if not history_is_rebuilt(stored, photos, retired_at):
        result.pinned = True
        for s in statements_for(stored, photos):
            session.execute(text("""
                INSERT INTO deployment_statements
                    (camera_id, site_id, from_at, until_at, fixed_until_at, source)
                VALUES (:camera_id, :site_id, :from_at, :until_at, :fixed_until_at, 'carried_over')
            """), {"camera_id": camera_id, **s})
            result.statements += 1
        result.skipped_without_site = sum(1 for s in stored if s.site_id is None)

    rebuild_camera(session, camera_id, announce=False)

    after_stored, after_photos = load(session, camera_id)
    result.exceptions = gate(
        rows_of(stored), rows_of(after_stored),
        {p.id: p.deployment_id for p in photos},
        {p.id: p.deployment_id for p in after_photos},
    )
    return result


def site_pins(session: Session) -> dict[int, tuple[float, float]]:
    return {
        r.id: (r.lat, r.lon)
        for r in session.execute(text("""
            SELECT id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM sites
        """))
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="Write. Without it, a dry run.")
    args = parser.parse_args()
    mode = "APPLY" if args.apply else "DRY RUN (rolled back)"

    engine = create_engine(get_settings().database_url)
    with Session(engine) as session:
        done = session.execute(
            text("SELECT deployments_carried_over_at FROM server_settings LIMIT 1")
        ).scalar()
        if done is not None:
            print(f"Deployments were carried over on {done}, nothing to do.")
            return

        cameras = session.execute(text(
            "SELECT id, coalesce(device_id, id::text) AS device_id, retired_at FROM cameras ORDER BY id"
        )).all()
        pins_before = site_pins(session)
        session.rollback()

        results = []
        for cam in cameras:
            results.append(carry_over_camera(session, cam.id, cam.device_id, cam.retired_at))
            if args.apply:
                session.commit()
            else:
                session.flush()

        pins_after = site_pins(session)
        pin_moves = sorted(
            (round(calculate_gps_distance(*pins_before[s], *pins_after[s]), 1), s)
            for s in pins_before.keys() & pins_after.keys()
        )
        if args.apply:
            session.execute(text(
                "UPDATE server_settings SET deployments_carried_over_at = :now"
            ), {"now": datetime.now(timezone.utc)})
            session.commit()
        else:
            session.rollback()

    pinned = [r for r in results if r.pinned]
    with_exceptions = [r for r in results if r.exceptions]
    lines = [
        f"=== {mode} ===",
        f"cameras               : {len(results)}",
        f"automatic             : {len(results) - len(pinned)}",
        f"pinned by statements  : {len(pinned)} ({sum(r.statements for r in pinned)} statements)",
    ]
    skipped = sum(r.skipped_without_site for r in pinned)
    if skipped:
        lines.append(f"deployments without site, left to GPS: {skipped}")
    lines.append(
        f"site pins moved       : {sum(1 for m, _ in pin_moves if m > 0)}, "
        f"furthest {pin_moves[-1][0] if pin_moves else 0} m"
    )
    lines.append(f"cameras with changes  : {len(with_exceptions)}")
    for r in with_exceptions:
        lines.append(f"  camera {r.camera_id} ({r.device_id}){' pinned' if r.pinned else ''}:")
        lines.extend(f"    {e}" for e in r.exceptions)
    lines.extend(
        f"  site {site_id} pin moved {metres} m"
        for metres, site_id in pin_moves if metres > PIN_REPORT_METRES
    )
    report = "\n".join(lines)
    print(report)
    with open(REPORT_PATH, "w") as f:
        f.write(report + "\n")
    logger.info(
        "Deployment carry-over", mode=mode, cameras=len(results), pinned=len(pinned),
        with_changes=len(with_exceptions),
    )


if __name__ == "__main__":
    main()
