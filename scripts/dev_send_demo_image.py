"""
Dev-only demo helper. Inject a classified detection through the real pipeline.

For demos and screen recordings: drop a wildlife detection into a project so it
shows up on the map and (when a matching active rule exists) fires the normal
notifications, EarthRanger, email, Telegram, exactly like a live capture.

Two ways to pick the photo:

  --species wolf   Reuse an image already labelled that species as the source.
                   The classifier sees the same photo, so the label is
                   guaranteed. This is the reliable demo path.
  --image PATH     Ingest a specific JPG (path inside the container). The label
                   is then whatever the classifier decides.

Nothing is mocked: it uploads to MinIO, runs the site/deployment resolver via
create_image_record, and publishes to the ingestion queue, so detection and
classification run for real.

Run inside the ingestion container on a DEV server:

    docker compose exec -T ingestion python /app/scripts/dev_send_demo_image.py --species wolf
    docker compose exec -T ingestion python /app/scripts/dev_send_demo_image.py --species fox --project 1 --count 3
    docker compose exec -T ingestion python /app/scripts/dev_send_demo_image.py --image /tmp/bear.jpg --device 861943070031629

The image lands on the target camera's current site by default, pass --gps
lat,lon to place it somewhere specific.

NEVER run this on a production server. It creates real image rows and fires real
notifications to whoever the project's rules point at. Code is baked into the
image, so after `git pull` on a dev server, rebuild the ingestion image before
this file is available at /app/scripts (or docker cp it in for a quick test).
"""
import argparse
import os
import sys
import uuid as uuid_module
from datetime import datetime

# Ingestion service code (db_operations, storage_operations) lives at /app.
sys.path.insert(0, "/app")

from PIL import Image as PILImage
from sqlalchemy import text

from shared.database import get_db_session
from shared.storage import StorageClient, BUCKET_RAW_IMAGES
from shared.queue import RedisQueue, QUEUE_IMAGE_INGESTED

from db_operations import (
    create_image_record,
    get_camera_by_device_id,
    get_server_timezone,
)
from storage_operations import upload_image_to_minio, generate_and_upload_thumbnail

LOCAL_SRC = "/tmp/dev_demo_src.jpg"


def now_naive() -> datetime:
    """Camera wall-clock now, naive, matching how ingestion stores captured_at."""
    return datetime.now(get_server_timezone()).replace(tzinfo=None)


def find_source_by_species(species: str, project_id):
    """The highest-confidence image already labelled `species`, optionally within
    one project. Returns (storage_path, filename, device_id, confidence) or None."""
    sql = text("""
        SELECT i.storage_path, i.filename, c.device_id, cl.confidence
        FROM images i
        JOIN cameras c ON c.id = i.camera_id
        JOIN detections d ON d.image_id = i.id
        JOIN classifications cl ON cl.detection_id = d.id
        WHERE cl.species = :species
          AND i.status = 'classified'
          AND i.is_hidden = false
          AND (:project_id IS NULL OR c.project_id = :project_id)
        ORDER BY cl.confidence DESC
        LIMIT 1
    """)
    with get_db_session() as s:
        return s.execute(sql, {"species": species, "project_id": project_id}).first()


def deployment_gps(device_id: str):
    """(lat, lon) of the camera's current deployment, or None if it has no location."""
    sql = text("""
        SELECT ST_Y(dp.location::geometry), ST_X(dp.location::geometry)
        FROM deployments dp
        JOIN cameras c ON c.id = dp.camera_id
        WHERE c.device_id = :device_id AND dp.end_date IS NULL AND dp.location IS NOT NULL
        ORDER BY dp.deployment_number DESC
        LIMIT 1
    """)
    with get_db_session() as s:
        row = s.execute(sql, {"device_id": device_id}).first()
    return (float(row[0]), float(row[1])) if row else None


def send_one(local_path: str, device_id: str, gps, note: str) -> str:
    """One image through the real ingestion path."""
    camera_id = get_camera_by_device_id(device_id)
    if camera_id is None:
        sys.exit(f"No camera with device_id {device_id!r} in this database.")
    with PILImage.open(local_path) as im:
        width, height = im.size
    image_uuid = str(uuid_module.uuid4())
    filename = os.path.basename(local_path)
    storage_path = upload_image_to_minio(local_path, device_id, image_uuid, filename)
    thumbnail_path = generate_and_upload_thumbnail(local_path, device_id, image_uuid, filename)
    create_image_record(
        image_uuid=image_uuid,
        camera_id=camera_id,
        filename=filename,
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        captured_at=now_naive(),
        gps_location=gps,
        exif_metadata={"source": "dev_send_demo_image", "note": note,
                       "width": width, "height": height},
    )
    RedisQueue(QUEUE_IMAGE_INGESTED).publish(
        {"image_uuid": image_uuid, "storage_path": storage_path, "camera_id": camera_id}
    )
    print(f"  sent {image_uuid}  device={device_id}  gps=({gps[0]:.5f}, {gps[1]:.5f})  [{note}]")
    return image_uuid


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Dev-only: inject a demo detection through the real pipeline."
    )
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--species", help="Reuse an existing image already labelled this species.")
    source.add_argument("--image", help="Path (inside the container) to a specific JPG to ingest.")
    ap.add_argument("--project", type=int, default=None,
                    help="Project to source the --species image from, and default target camera.")
    ap.add_argument("--device", help="Target camera device_id. Defaults to the source image's camera.")
    ap.add_argument("--count", type=int, default=1, help="How many to send (default 1).")
    ap.add_argument("--gps", help="lat,lon to place it. Default: the target camera's current site.")
    args = ap.parse_args()

    if args.species:
        row = find_source_by_species(args.species, args.project)
        if row is None:
            scope = f" in project {args.project}" if args.project else ""
            sys.exit(f"No image labelled {args.species!r} found{scope}. Try --image instead.")
        storage_path, src_filename, src_device_id, conf = row
        device_id = args.device or src_device_id
        StorageClient().download_file(BUCKET_RAW_IMAGES, storage_path, LOCAL_SRC)
        local_path = LOCAL_SRC
        note = f"{args.species} demo (from {src_filename}, conf {conf:.2f})"
    else:
        if not os.path.isfile(args.image):
            sys.exit(f"File not found: {args.image}")
        if not args.device:
            sys.exit("--image requires --device (which camera to attach it to).")
        device_id = args.device
        local_path = args.image
        note = f"demo image {os.path.basename(args.image)}"

    if args.gps:
        try:
            lat, lon = (float(x) for x in args.gps.split(","))
        except ValueError:
            sys.exit("--gps must be 'lat,lon', for example --gps 46.2679,106.7552")
        gps = (lat, lon)
    else:
        gps = deployment_gps(device_id)
        if gps is None:
            sys.exit(f"Camera {device_id} has no deployment location; pass --gps lat,lon.")

    print(f"Sending {args.count} demo image(s) to device {device_id} at {gps} ...")
    for _ in range(args.count):
        send_one(local_path, device_id, gps, note)
    print("Done. Detection and classification run next; matching active rules will "
          "fire (EarthRanger, email, Telegram).")


if __name__ == "__main__":
    main()
