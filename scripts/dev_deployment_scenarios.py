"""
Dev-only. Make a project of made-up cameras, each telling one deployment
story, for end to end tests of the camera updates check (DEPLOYMENTS_PLAN.md,
phase 3 onwards).

Every photo goes through the real live path: stored in MinIO, written with
create_image_record (which rebuilds the camera's deployments) and queued for detection and classification. Photos
arrive in capture order, except where a scenario says they arrive late.

Run inside the ingestion container on a DEV server:

    docker compose exec -T ingestion python /app/scripts/dev_deployment_scenarios.py

The project is called "Deployment scenarios". The script refuses to run when
it exists already: delete it in the app first (Projects, the project's menu),
then run again. A restore of a production backup wipes it as well. The
sites lie on a made-up grid on the Veluwe, far from any real project.

Refuses to run on anything but a development server (ENVIRONMENT).
"""
import math
import os
import random
import sys
import uuid as uuid_module
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional

# Ingestion service code (db_operations, storage_operations) lives at /app.
sys.path.insert(0, "/app")

from PIL import Image as PILImage, ImageDraw, ImageFont
from sqlalchemy import text

from shared.database import get_db_session
from shared.notify_guard import is_development
from shared.queue import QUEUE_IMAGE_INGESTED, RedisQueue

from db_operations import create_image_record
from storage_operations import generate_and_upload_thumbnail, upload_image_to_minio

PROJECT_NAME = "Deployment scenarios"
FIRST_DAY = date(2026, 8, 1)
LOCAL_PHOTO = "/tmp/scenario_photo.jpg"

# A made-up grid on the Veluwe. Names make the sites easy to read on the page.
SITES = {
    "Pond": (52.0800, 5.8300),
    "Meadow": (52.0900, 5.8150),
    "Ridge": (52.0935, 5.8300),  # 1.5 km north of Pond
    "Beech wood": (52.0700, 5.8500),
    "Clearing": (52.0850, 5.8550),
    "Stream west": (52.0750, 5.8100),
    "Stream east": (52.0750, 5.8100 + 180 / (111_320 * math.cos(math.radians(52.075)))),  # 180 m east
    "Heath": (52.0980, 5.8450),
    "Fen": (52.1050, 5.8650),
    "Old mill": (52.0620, 5.8620),
    "Spruce hill": (52.1100, 5.8150),
    "Bog": (52.0580, 5.8250),
    "Larch stand": (52.0650, 5.8000),
    "Bracken": (52.1150, 5.8400),
}

rng = random.Random(20261120)


def offset(point: tuple[float, float], north_m: float = 0.0, east_m: float = 0.0) -> tuple[float, float]:
    lat, lon = point
    return lat + north_m / 111_320, lon + east_m / (111_320 * math.cos(math.radians(lat)))


def jitter(point: tuple[float, float]) -> tuple[float, float]:
    """A GPS fix within about 10 m of the spot, as real cameras give."""
    return offset(point, rng.uniform(-10, 10), rng.uniform(-10, 10))


@dataclass
class Photo:
    device: str
    taken: datetime
    gps: Optional[tuple[float, float]]
    place: str  # where the camera really stood, written on the photo
    late: bool = False  # arrives after every on-time photo


def day(d: date) -> datetime:
    """A capture moment on that day, at a random hour, as a trail camera gives."""
    return datetime.combine(d, time(rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59)))


def days(first: date, last: date):
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


def stay(device: str, site: str, first: date, last: date, gps: bool = True) -> list[Photo]:
    """One photo a day at a site, both days included."""
    return [Photo(device, day(d), jitter(SITES[site]) if gps else None, site) for d in days(first, last)]


def scenarios(today: date) -> dict[str, list[Photo]]:
    s: dict[str, list[Photo]] = {}

    s["S01-STAYS"] = stay("S01-STAYS", "Pond", FIRST_DAY, today)

    s["S02-REAL-MOVE"] = (
        stay("S02-REAL-MOVE", "Pond", FIRST_DAY, date(2026, 8, 31))
        + stay("S02-REAL-MOVE", "Ridge", date(2026, 9, 1), today)
    )

    # Never moved. Two photos of one burst read 400 m north.
    bad = offset(SITES["Meadow"], north_m=400)
    burst = datetime(2026, 9, 10, 6, 12, 0)
    s["S03-FALSE-MOVE"] = stay("S03-FALSE-MOVE", "Meadow", FIRST_DAY, today) + [
        Photo("S03-FALSE-MOVE", burst, jitter(bad), "Meadow (GPS 400 m off)"),
        Photo("S03-FALSE-MOVE", burst + timedelta(seconds=1), jitter(bad), "Meadow (GPS 400 m off)"),
    ]

    # Moved 180 m, inside the 250 m the rule allows.
    s["S04-MISSED-MOVE"] = (
        stay("S04-MISSED-MOVE", "Stream west", FIRST_DAY, date(2026, 9, 14))
        + stay("S04-MISSED-MOVE", "Stream east", date(2026, 9, 15), today)
    )

    # One stray fix 3 km off.
    s["S05-ONE-STRAY"] = stay("S05-ONE-STRAY", "Spruce hill", FIRST_DAY, today) + [
        Photo("S05-ONE-STRAY", datetime(2026, 10, 5, 14, 3, 0), jitter(offset(SITES["Spruce hill"], east_m=3000)),
              "Spruce hill (GPS 3 km off)"),
    ]

    # A camera without GPS, at Meadow.
    s["S06-NO-GPS"] = stay("S06-NO-GPS", "Meadow", date(2026, 10, 1), today, gps=False)

    # GPS that drops out: every third October photo without GPS, two at (0, 0).
    gaps = stay("S07-GPS-GAPS", "Clearing", FIRST_DAY, today)
    october = [p for p in gaps if p.taken.month == 10]
    for i, p in enumerate(october):
        if i % 3 == 0:
            p.gps = None
    october[1].gps = (0.0, 0.0)
    october[4].gps = (0.0, 0.0)
    s["S07-GPS-GAPS"] = gaps

    # Went silent on 20 September.
    s["S08-SILENT"] = stay("S08-SILENT", "Bog", FIRST_DAY, date(2026, 9, 20))

    # Away and back.
    s["S09-AND-BACK"] = (
        stay("S09-AND-BACK", "Old mill", FIRST_DAY, date(2026, 8, 31))
        + stay("S09-AND-BACK", "Beech wood", date(2026, 9, 1), date(2026, 9, 30))
        + stay("S09-AND-BACK", "Old mill", date(2026, 10, 1), today)
    )

    # Next to S01 at Pond.
    s["S10-SHARED"] = stay("S10-SHARED", "Pond", date(2026, 8, 15), today)

    # Moved on 1 October, first photo at the new place on 8 October.
    s["S11-LATE-PHOTO"] = (
        stay("S11-LATE-PHOTO", "Heath", FIRST_DAY, date(2026, 9, 30))
        + stay("S11-LATE-PHOTO", "Fen", date(2026, 10, 8), today)
    )

    # Moved on 1 September. Its August photos from the old place arrive last.
    old = stay("S12-OLD-CARD", "Larch stand", FIRST_DAY, date(2026, 8, 31))
    for p in old:
        p.late = True
    s["S12-OLD-CARD"] = old + stay("S12-OLD-CARD", "Bracken", date(2026, 9, 1), today)

    return s


def draw(photo: Photo) -> str:
    """A plain picture that says what really happened: the camera, where it
    stood and when, so every thumbnail can be checked against the page.
    Detection finds nothing on it, so it lands as empty."""
    im = PILImage.new("RGB", (960, 540), (52, 78, 65))
    pen = ImageDraw.Draw(im)
    font = ImageFont.load_default(size=44)
    gps = "no GPS" if photo.gps is None else f"GPS {photo.gps[0]:.5f}, {photo.gps[1]:.5f}"
    lines = [photo.device, f"Really at {photo.place}", f"{photo.taken:%d %b %Y %H:%M:%S}", gps]
    for i, line in enumerate(lines):
        pen.text((40, 60 + i * 100), line, fill=(240, 240, 230), font=font)
    im.save(LOCAL_PHOTO, "JPEG", quality=80)
    return LOCAL_PHOTO


def make_project(devices: list[str]) -> tuple[int, dict[str, int]]:
    """The project, its named sites and one camera per scenario."""
    with get_db_session() as session:
        if session.execute(text("SELECT 1 FROM projects WHERE name = :n"), {"n": PROJECT_NAME}).first():
            sys.exit(f"Project {PROJECT_NAME!r} exists. Delete it in the app first, then run again.")
        model = session.execute(text("SELECT classification_model FROM projects ORDER BY id LIMIT 1")).scalar()
        project_id = session.execute(
            text("INSERT INTO projects (name, description, classification_model) VALUES (:n, :d, :m) RETURNING id"),
            {"n": PROJECT_NAME, "d": "Made-up cameras for testing the camera updates check. Dev only.",
             "m": model or "EUR-DF-v1-4"},
        ).scalar_one()
        for name, (lat, lon) in SITES.items():
            session.execute(text("""
                INSERT INTO sites (uuid, project_id, name, location, created_at)
                VALUES (:u, :p, :n, ST_GeogFromText(:wkt), now())
            """), {"u": str(uuid_module.uuid4()), "p": project_id, "n": name, "wkt": f"POINT({lon} {lat})"})
        cameras = {}
        for device in devices:
            cameras[device] = session.execute(text("""
                INSERT INTO cameras (device_id, project_id, status) VALUES (:d, :p, 'active') RETURNING id
            """), {"d": device, "p": project_id}).scalar_one()
        session.commit()
    return project_id, cameras


def send(photo: Photo, camera_id: int, queue: RedisQueue) -> None:
    path = draw(photo)
    image_uuid = str(uuid_module.uuid4())
    filename = f"{photo.device}_{photo.taken:%Y%m%d_%H%M%S}.jpg"
    storage_path = upload_image_to_minio(path, photo.device, image_uuid, filename)
    thumbnail_path = generate_and_upload_thumbnail(path, photo.device, image_uuid, filename)
    create_image_record(
        image_uuid=image_uuid,
        camera_id=camera_id,
        filename=filename,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        captured_at=photo.taken,
        gps_reading=photo.gps,
        exif_metadata={"source": "dev_deployment_scenarios"},
    )
    queue.publish({"image_uuid": image_uuid, "storage_path": storage_path, "camera_id": camera_id})


def main() -> None:
    if not is_development():
        sys.exit("Refusing to run: this is not a development server (ENVIRONMENT).")
    stories = scenarios(date.today())
    photos = [p for ps in stories.values() for p in ps]
    # On-time photos in capture order, then the late ones.
    photos.sort(key=lambda p: (p.late, p.taken))

    project_id, cameras = make_project(list(stories))
    print(f"Project {project_id} {PROJECT_NAME!r}: {len(SITES)} sites, {len(cameras)} cameras, "
          f"{len(photos)} photos to send")
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)
    for n, photo in enumerate(photos, start=1):
        send(photo, cameras[photo.device], queue)
        if n % 200 == 0:
            print(f"  {n} sent")
    os.remove(LOCAL_PHOTO)
    print("Done. Detection and classification run next, in the background.")


if __name__ == "__main__":
    main()
