"""
Rebuild every camera's deployments from the stored GPS readings and compare
them with the deployments table. Step 1b of DEPLOYMENTS_PLAN.md.

Read only, there is no write path. Run it in the api container:

    docker compose exec -T api python /app/scripts/replay_deployments.py
    docker compose exec -T api python /app/scripts/replay_deployments.py --project-id 2 --json /tmp/replay.json

Each camera is built twice with shared.deployment_build:

- in arrival order (images.id), as live ingestion saw the photos. This must
  equal what is stored, unless something else changed the stored rows.
- in capture order (captured_at, then id), as phase 2 will build. A
  difference here only is the effect of that switch.

A camera that differs gets the first reason that applies, see REASONS. What
stays unexplained is the list to look at by hand.
"""
import argparse
import json
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Optional

sys.path.insert(0, '/app')

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from shared.config import get_settings  # noqa: E402
from shared.deployment_build import BuiltDeployment, Reading, build_deployments  # noqa: E402
from shared.geo import calculate_gps_distance  # noqa: E402

# Pins within this distance are the same pin. Both sides run the same float
# arithmetic, so real agreement is far below a metre.
PIN_TOLERANCE_M = 1.0

# Feed actions that changed a deployment by hand.
HAND_ACTIONS = ('not_moved', 'set_site', 'new_site')

# In the order they are tried. The first that applies is the reason.
REASONS = [
    'same',
    'set by a person',
    'set by an upload',
    'camera retired',
    'opened by a report',
    'merged at one site',
    'photos deleted',
    'older rule',
    'arrival order',
    'unexplained',
]


@dataclass(frozen=True)
class Photo:
    id: int
    taken_at: datetime
    ingested_at: datetime
    lat: float
    lon: float
    deployment_id: Optional[int]


@dataclass(frozen=True)
class Stored:
    id: int
    start_date: date
    end_date: Optional[date]
    lat: float
    lon: float
    reading_count: int


@dataclass
class Camera:
    """Everything the comparison needs to know about one camera."""
    id: int
    device_id: str
    project_id: Optional[int]
    photos: list[Photo]
    stored: list[Stored]
    hand_corrected: bool = False
    has_upload: bool = False
    retired: bool = False


@dataclass
class Result:
    camera_id: int
    device_id: str
    project_id: Optional[int]
    reason: str
    difference: str = ''
    built: int = 0
    stored: int = 0
    seconds: float = 0.0


# Comparison, plain functions without a database


def first_difference(built: list[BuiltDeployment], stored: list[Stored], photos: list[Photo]) -> Optional[str]:
    """Where the rebuild and the stored rows first disagree, in words, or None
    when they agree on the number of deployments, their dates, their pins and
    which deployment every photo is on."""
    if len(built) != len(stored):
        return f"{len(built)} built, {len(stored)} stored"
    for i, (b, s) in enumerate(zip(built, stored), start=1):
        if (b.start_date, b.end_date) != (s.start_date, s.end_date):
            return f"deployment {i}: built {b.start_date} to {b.end_date}, stored {s.start_date} to {s.end_date}"
        if calculate_gps_distance(b.lat, b.lon, s.lat, s.lon) > PIN_TOLERANCE_M:
            metres = calculate_gps_distance(b.lat, b.lon, s.lat, s.lon)
            return f"deployment {i}: pins {metres:.0f} m apart"
    stored_index = {s.id: i for i, s in enumerate(stored)}
    built_index = {image_id: i for i, b in enumerate(built) for image_id in b.image_ids}
    for p in photos:
        if built_index.get(p.id) != stored_index.get(p.deployment_id):
            return f"photo {p.id} on a different deployment"
    return None


def first_differing_photo(built: list[BuiltDeployment], stored: list[Stored], photos: list[Photo]) -> Optional[Photo]:
    """The photo where the two histories part: the first photo on a
    different deployment, else the first photo of the first deployment whose
    dates or pin differ."""
    stored_index = {s.id: i for i, s in enumerate(stored)}
    built_index = {image_id: i for i, b in enumerate(built) for image_id in b.image_ids}
    by_id = {p.id: p for p in photos}
    for p in photos:
        if built_index.get(p.id) != stored_index.get(p.deployment_id):
            return p
    for b, s in zip(built, stored):
        same = (b.start_date, b.end_date) == (s.start_date, s.end_date) and \
            calculate_gps_distance(b.lat, b.lon, s.lat, s.lon) <= PIN_TOLERANCE_M
        if not same and b.image_ids:
            return by_id[b.image_ids[0]]
    return photos[0] if photos else None


def merged_at_one_site(built: list[BuiltDeployment], stored: list[Stored], photos: list[Photo]) -> bool:
    """Two rebuilt deployments in a row whose photos all sit on one stored
    deployment: a merge joined what the rule had split."""
    deployment_of = {p.id: p.deployment_id for p in photos}
    homes = []
    for b in built:
        ids = {deployment_of.get(i) for i in b.image_ids}
        homes.append(ids.pop() if len(ids) == 1 else None)
    return any(a is not None and a == b for a, b in zip(homes, homes[1:]))


def photos_deleted(built: list[BuiltDeployment], stored: list[Stored]) -> bool:
    """A stored pin averaged more readings than the photos that are left: photos
    were deleted after they arrived, and their readings still pull the pin."""
    return len(built) == len(stored) and any(
        s.reading_count > b.reading_count for b, s in zip(built, stored)
    )


def explain(cam: Camera, by_arrival: list[BuiltDeployment], by_capture: list[BuiltDeployment],
            cutoff: Optional[datetime]) -> tuple[str, str]:
    """(reason, first difference in words) for one camera."""
    arrival_diff = first_difference(by_arrival, cam.stored, cam.photos)
    capture_diff = first_difference(by_capture, cam.stored, cam.photos)
    if arrival_diff is None and capture_diff is None:
        return 'same', ''
    diff = arrival_diff or capture_diff
    if arrival_diff is None:
        return 'arrival order', capture_diff
    if cam.hand_corrected:
        return 'set by a person', diff
    if cam.has_upload:
        return 'set by an upload', diff
    if cam.retired and cam.stored and cam.stored[-1].end_date is not None:
        return 'camera retired', diff
    if cam.stored and cam.photos and cam.stored[0].start_date < min(p.taken_at for p in cam.photos).date():
        return 'opened by a report', diff
    if merged_at_one_site(by_arrival, cam.stored, cam.photos):
        return 'merged at one site', diff
    if photos_deleted(by_arrival, cam.stored):
        return 'photos deleted', diff
    parting = first_differing_photo(by_arrival, cam.stored, cam.photos)
    if cutoff is not None and parting is not None and parting.ingested_at <= cutoff:
        return 'older rule', diff
    return 'unexplained', diff


def replay_camera(cam: Camera, cutoff: Optional[datetime]) -> Result:
    started = time.perf_counter()
    arrival = sorted(cam.photos, key=lambda p: p.id)
    capture = sorted(cam.photos, key=lambda p: (p.taken_at, p.id))
    by_arrival = build_deployments([_reading(p) for p in arrival])
    by_capture = build_deployments([_reading(p) for p in capture])
    seconds = time.perf_counter() - started
    reason, diff = explain(cam, by_arrival, by_capture, cutoff)
    return Result(cam.id, cam.device_id, cam.project_id, reason, diff,
                  len(by_arrival), len(cam.stored), seconds)


def _reading(p: Photo) -> Reading:
    return Reading(p.id, p.taken_at, p.lat, p.lon)


# Loading


def rule_cutoff(session: Session) -> Optional[datetime]:
    """The moment this server got the current rule, as far as the data tells.
    Migration 20260616_rejections_feed stamped every photo that existed then
    with one shared ingested_at, and the current rule (v0.6.2) followed within
    days. The most common ingested_at, when many photos share it, is that
    stamp. None when no such stamp exists, then nothing is called older."""
    row = session.execute(text("""
        SELECT ingested_at, count(*) AS n FROM images
        GROUP BY ingested_at ORDER BY n DESC LIMIT 1
    """)).first()
    if row is None or row.n < 10:
        return None
    return row.ingested_at


def load_cameras(session: Session, project_id: Optional[int]) -> list[Camera]:
    project_filter = "AND c.project_id = :project_id" if project_id is not None else ""
    params = {"project_id": project_id, "hand": list(HAND_ACTIONS)}

    cameras = {
        r.id: Camera(r.id, r.device_id or str(r.id), r.project_id, [], [], retired=r.retired_at is not None)
        for r in session.execute(text(f"""
            SELECT c.id, c.device_id, c.project_id, c.retired_at FROM cameras c
            WHERE true {project_filter}
        """), params)
    }

    for r in session.execute(text(f"""
        SELECT i.id, i.camera_id, i.captured_at, i.ingested_at, i.gps_lat, i.gps_lon, i.deployment_id
        FROM images i JOIN cameras c ON c.id = i.camera_id
        WHERE i.gps_lat IS NOT NULL {project_filter}
        ORDER BY i.id
    """), params):
        cameras[r.camera_id].photos.append(
            Photo(r.id, r.captured_at, r.ingested_at, r.gps_lat, r.gps_lon, r.deployment_id)
        )

    for r in session.execute(text(f"""
        SELECT d.id, d.camera_id, d.start_date, d.end_date, d.gps_reading_count,
               ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lon
        FROM deployments d JOIN cameras c ON c.id = d.camera_id
        WHERE true {project_filter}
        ORDER BY d.camera_id, d.deployment_number
    """), params):
        # deployment_number is the order live ingestion made them in, which is
        # the order the rebuild in arrival order makes them in. After an old
        # SD card that is not the order of their start dates.
        cameras[r.camera_id].stored.append(
            Stored(r.id, r.start_date, r.end_date, r.lat, r.lon, r.gps_reading_count)
        )

    for r in session.execute(text(f"""
        SELECT DISTINCT d.camera_id FROM deployments d JOIN cameras c ON c.id = d.camera_id
        WHERE d.site_source = 'manual' {project_filter}
        UNION
        SELECT DISTINCT f.camera_id FROM feed_events f JOIN cameras c ON c.id = f.camera_id
        WHERE f.resolved_action = ANY(:hand) {project_filter}
    """), params):
        cameras[r.camera_id].hand_corrected = True

    for r in session.execute(text(f"""
        SELECT DISTINCT i.camera_id FROM images i JOIN cameras c ON c.id = i.camera_id
        WHERE i.origin = 'bulk' {project_filter}
    """), params):
        cameras[r.camera_id].has_upload = True

    # A camera with neither photos with GPS nor deployments has nothing to compare.
    return [c for c in cameras.values() if c.photos or c.stored]


# Report


def summarise(results: list[Result]) -> dict:
    per_project: dict = defaultdict(Counter)
    for r in results:
        per_project[r.project_id][r.reason] += 1
    slowest = max(results, key=lambda r: r.seconds, default=None)
    return {
        "cameras": len(results),
        "per_project": {str(p): dict(c) for p, c in sorted(per_project.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))},
        "total": dict(Counter(r.reason for r in results)),
        "build_seconds_total": round(sum(r.seconds for r in results), 3),
        "build_seconds_slowest_camera": round(slowest.seconds, 4) if slowest else 0.0,
        "slowest_camera": slowest.device_id if slowest else None,
    }


def print_report(summary: dict, results: list[Result], cutoff: Optional[datetime]) -> None:
    print(f"Older rule cutoff: {cutoff or 'none found'}")
    print(f"Cameras compared: {summary['cameras']}")
    print()
    reasons = [r for r in REASONS if r in summary['total']]
    print("project  " + "  ".join(f"{r:>18}" for r in reasons))
    for project, counts in summary['per_project'].items():
        print(f"{project:>7}  " + "  ".join(f"{counts.get(r, 0):>18}" for r in reasons))
    print(f"{'total':>7}  " + "  ".join(f"{summary['total'].get(r, 0):>18}" for r in reasons))
    print()
    print(f"Build time: {summary['build_seconds_total']} s in total, "
          f"slowest camera {summary['slowest_camera']} at {summary['build_seconds_slowest_camera']} s")
    unexplained = [r for r in results if r.reason == 'unexplained']
    if unexplained:
        print()
        print("Unexplained:")
        for r in unexplained:
            print(f"  camera {r.camera_id} ({r.device_id}), project {r.project_id}: "
                  f"{r.difference} [{r.built} built, {r.stored} stored]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--project-id", type=int, default=None, help="Only this project")
    parser.add_argument("--json", default=None, help="Also write the result as JSON to this path")
    args = parser.parse_args()

    engine = create_engine(get_settings().database_url)
    with Session(engine) as session:
        cutoff = rule_cutoff(session)
        cameras = load_cameras(session, args.project_id)
        session.rollback()

    results = [replay_camera(cam, cutoff) for cam in cameras]
    summary = summarise(results)
    print_report(summary, results, cutoff)

    if args.json:
        with open(args.json, "w") as f:
            json.dump({
                "cutoff": cutoff.isoformat() if cutoff else None,
                "summary": summary,
                "cameras": [asdict(r) for r in results],
            }, f, indent=2, default=str)
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
