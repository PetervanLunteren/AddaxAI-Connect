"""
Dev-only. Make "Busy project": a made-up project where many things need
somebody at once, to see how Needs attention (the To do list in the top bar)
feels on a busy day. Every line it can show is there:

- inactive cameras (silent for 12 days), low battery, SD cards nearly full,
  a camera rejecting files, cameras with photos without a site;
- a suspicious move (a GPS burst 400 m off and back) next to a real move;
- SIM cards expiring, one already expired;
- service tasks: two for the person given with --assignee (one overdue),
  two overdue for nobody, one planned later;
- a failing EarthRanger integration, and no species list on a fixed-class
  model, so "Choose the species" shows.

Photos go through the real live path (scripts/dev_deployment_scenarios.py:
MinIO, create_image_record, the detection queue). Afterwards their arrival
time is set to their capture time, as if each came in live that day, so a
camera that stopped 12 days ago reads as inactive. Health readings, the
rejection, SIM dates, tasks and the integration are written directly.

Run inside the ingestion container on a DEV server:

    docker compose exec -T ingestion python /app/scripts/dev_busy_project.py --assignee you@example.org

Refused when the project exists: delete it in the app to make it again.
Refuses to run on anything but a development server (ENVIRONMENT).
"""
import argparse
import json
import os
import sys
import uuid as uuid_module
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from dev_deployment_scenarios import LOCAL_PHOTO, Photo, day, days, jitter, offset, send
from shared.database import get_db_session
from shared.notify_guard import is_development
from shared.queue import QUEUE_IMAGE_INGESTED, RedisQueue

PROJECT_NAME = "Busy project"
MODEL = "EUR-DF-v1-4"  # DeepFaune: a fixed-class model, so it asks for a species list

# A made-up grid east of the Deployment scenarios grid, far from real projects.
SITES = {
    "North gate": (52.1300, 5.9000),
    "Badger sett": (52.1250, 5.9150),
    "Old oak": (52.1200, 5.9300),
    "Dune edge": (52.1150, 5.9050),
    "Sheep fold": (52.1100, 5.9200),
    "Brook": (52.1050, 5.9350),
    "Pine row": (52.1000, 5.9100),
}

# device: (site, last day it sent as days ago, health readings)
CAMERAS = {
    "BUSY-01": ("North gate", 0, {"battery_percentage": 86, "sd_utilization_percentage": 31}),
    "BUSY-02": ("Badger sett", 0, {"battery_percentage": 74, "sd_utilization_percentage": 44}),  # suspicious trip
    "BUSY-03": ("Old oak", 0, {"battery_percentage": 91, "sd_utilization_percentage": 12}),  # real move
    "BUSY-04": ("Dune edge", 0, {"battery_percentage": 66, "sd_utilization_percentage": 58}),
    "BUSY-05": ("Sheep fold", 12, {"battery_percentage": 3, "sd_utilization_percentage": 40}),  # inactive
    "BUSY-06": ("Brook", 15, {"battery_percentage": 55, "sd_utilization_percentage": 97}),  # inactive
    "BUSY-07": ("Pine row", 0, {"battery_percentage": 22, "sd_utilization_percentage": 35}),
    "BUSY-08": ("North gate", 0, {"battery_percentage": 14, "sd_utilization_percentage": 20}),
    "BUSY-09": ("Old oak", 0, {"battery_percentage": 9, "sd_utilization_percentage": 64}),
    "BUSY-10": ("Badger sett", 0, {"battery_percentage": 80, "sd_utilization_percentage": 88}),
    "BUSY-11": ("Brook", 0, {"battery_percentage": 70, "sd_utilization_percentage": 95}),
    "BUSY-12": ("Dune edge", 0, {"battery_percentage": 61, "sd_utilization_percentage": 27}),  # rejecting
    "BUSY-13": ("Sheep fold", 0, {"battery_percentage": 77, "sd_utilization_percentage": 18}),  # no GPS
    "BUSY-14": ("Pine row", 0, {"battery_percentage": 82, "sd_utilization_percentage": 21}),  # no GPS
}
NO_GPS = {"BUSY-13", "BUSY-14"}
DAYS = 30


def photos(today: date) -> list[Photo]:
    first = today - timedelta(days=DAYS)
    out: list[Photo] = []
    for device, (site, silent_for, _) in CAMERAS.items():
        last = today - timedelta(days=silent_for)
        if device == "BUSY-03":  # moved to Brook halfway, for real
            half = first + timedelta(days=DAYS // 2)
            out += [Photo(device, day(d), jitter(SITES["Old oak"]), "Old oak") for d in days(first, half)]
            out += [Photo(device, day(d), jitter(SITES["Brook"]), "Brook")
                    for d in days(half + timedelta(days=1), last)]
            continue
        gps = None if device in NO_GPS else SITES[site]
        out += [Photo(device, day(d), jitter(gps) if gps else None, site) for d in days(first, last)]
        if device == "BUSY-02":  # one burst read 400 m north, nine days ago
            burst = day(today - timedelta(days=9))
            bad = offset(SITES[site], north_m=400)
            out += [Photo(device, burst, jitter(bad), f"{site} (GPS 400 m off)"),
                    Photo(device, burst + timedelta(seconds=1), jitter(bad), f"{site} (GPS 400 m off)")]
    out.sort(key=lambda p: p.taken)
    return out


def make_project() -> tuple[int, dict[str, int]]:
    with get_db_session() as session:
        if session.execute(text("SELECT 1 FROM projects WHERE name = :n"), {"n": PROJECT_NAME}).scalar():
            sys.exit(f"{PROJECT_NAME!r} exists. Delete it in the app to make it again.")
        project_id = session.execute(text("""
            INSERT INTO projects (name, description, classification_model)
            VALUES (:n, 'Made-up cameras with many things that need somebody. Dev only.', :m) RETURNING id
        """), {"n": PROJECT_NAME, "m": MODEL}).scalar_one()
        for name, (lat, lon) in SITES.items():
            session.execute(text("""
                INSERT INTO sites (uuid, project_id, name, location, created_at)
                VALUES (:u, :p, :n, ST_GeogFromText(:wkt), now())
            """), {"u": str(uuid_module.uuid4()), "p": project_id, "n": name, "wkt": f"POINT({lon} {lat})"})
        cameras = {
            device: session.execute(text("""
                INSERT INTO cameras (device_id, project_id, status) VALUES (:d, :p, 'active') RETURNING id
            """), {"d": device, "p": project_id}).scalar_one()
            for device in CAMERAS
        }
        session.commit()
    return project_id, cameras


def set_the_rest(project_id: int, cameras: dict[str, int], assignee: str, today: date) -> None:
    with get_db_session() as session:
        ids = list(cameras.values())
        # Each photo arrived live when it was taken, never later than now
        # (a photo of today may carry a later hour), so the rejection below
        # is newer than every good photo.
        session.execute(text("""
            UPDATE images SET ingested_at = LEAST(captured_at AT TIME ZONE 'UTC', now() - interval '1 minute')
            WHERE camera_id = ANY(:ids)
        """), {"ids": ids})
        for device, (_, _, health) in CAMERAS.items():
            session.execute(text("UPDATE cameras SET config = CAST(:c AS json) WHERE id = :i"),
                            {"c": json.dumps({"last_health_report": health}), "i": cameras[device]})
        # Rejecting now: a refused file newer than its last good photo.
        session.execute(text("""
            INSERT INTO rejections (filename, disk_path, reason, device_id, camera_id, project_id, rejected_at)
            VALUES ('BUSY-12_no_fix.jpg', '/dev/null', 'missing_gps', 'BUSY-12', :c, :p, now())
        """), {"c": cameras["BUSY-12"], "p": project_id})
        for device, expiry in [("BUSY-04", today + timedelta(days=20)), ("BUSY-08", today - timedelta(days=5)),
                               ("BUSY-01", today + timedelta(days=200))]:
            session.execute(text("UPDATE cameras SET sim_expiry_date = :d WHERE id = :i"),
                            {"d": expiry, "i": cameras[device]})
        me = session.execute(text("SELECT id FROM users WHERE email = :e"), {"e": assignee}).scalar()
        if me is None:
            sys.exit(f"No user {assignee!r}.")
        session.execute(text("""
            INSERT INTO project_memberships (user_id, project_id, role)
            SELECT :u, :p, 'project-admin' WHERE NOT EXISTS (
                SELECT 1 FROM project_memberships WHERE user_id = :u AND project_id = :p)
        """), {"u": me, "p": project_id})
        tasks = [("BUSY-05", me, today - timedelta(days=4), '["battery_change"]'),
                 ("BUSY-11", me, today + timedelta(days=6), '["sd_card_swap"]'),
                 ("BUSY-06", None, today - timedelta(days=10), '["inspection"]'),
                 ("BUSY-09", None, today - timedelta(days=1), '["battery_change"]'),
                 ("BUSY-07", None, today + timedelta(days=14), '["cleaning"]')]
        for device, who, due, actions in tasks:
            session.execute(text("""
                INSERT INTO camera_service_tasks (camera_id, action_types, due_date, assigned_to_user_id)
                VALUES (:c, CAST(:a AS json), :d, :u)
            """), {"c": cameras[device], "a": actions, "d": due, "u": who})
        session.execute(text("""
            INSERT INTO project_integrations (project_id, kind, config, is_enabled, health_status, last_error)
            VALUES (:p, 'earthranger', CAST('{"api_key": "made-up"}' AS json), true, 'error',
                    'Made up for the busy project: no real EarthRanger server')
        """), {"p": project_id})
        session.commit()


def main() -> None:
    if not is_development():
        sys.exit("Refusing to run: this is not a development server (ENVIRONMENT).")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--assignee", required=True, help="Email of the user who gets two service tasks")
    args = ap.parse_args()
    today = date.today()
    project_id, cameras = make_project()
    shots = photos(today)
    print(f"Project {project_id} {PROJECT_NAME!r}: {len(cameras)} cameras, {len(shots)} photos")
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)
    for n, photo in enumerate(shots, start=1):
        send(photo, cameras[photo.device], queue)
        if n % 100 == 0:
            print(f"  {n} sent")
    os.remove(LOCAL_PHOTO)
    set_the_rest(project_id, cameras, args.assignee, today)
    print("Done. Detection and classification run next, in the background.")


if __name__ == "__main__":
    main()
