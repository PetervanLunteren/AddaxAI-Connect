"""
Put stranded images back on the pipeline queue.

An update rebuilds the containers (step 3) before it migrates the database
(step 4), so for the minute or two in between, new code is running against the
old schema. Every ORM read of Image selects the new columns, so on a server
with cameras uploading, anything that lands in that window dies with
`UndefinedColumn` and its queue message is consumed without being replaced.
The row survives with status 'pending', the file is safely in storage, and
nothing ever picks it up again.

Seen on drenthe 18 Aug 2026: two live captures at 09:50:37 and 09:51:06, while
migrations finished at 09:51:54.

The order is not the problem and must not be swapped. Migrating first would
run the OLD code against the NEW schema, and these migrations drop columns the
old models still declare (cameras.last_maintenance_at,
projects.blur_people_vehicles). Camera and blur queries run constantly, so
that would break far more than this does.

Why ten minutes. An image is legitimately 'pending' for a few seconds between
ingestion and detection picking it up. Republishing one of those would process
it twice and write duplicate detections. Anything still pending after ten
minutes has no live queue message behind it.

Unlike the backfill scripts beside it, this one previews by default and needs
--apply to act, because publishing here costs real ML inference.

Usage (on a server):
    docker compose exec -T api python /app/scripts/requeue_pending_images.py
    docker compose exec -T api python /app/scripts/requeue_pending_images.py --apply
"""
import argparse
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger
from shared.queue import (
    RedisQueue,
    QUEUE_IMAGE_INGESTED,
    QUEUE_IMAGE_INGESTED_BULK,
)

settings = get_settings()
logger = get_logger("requeue_pending_images")

# An image sitting pending longer than this has no queue message behind it.
STALE_AFTER_MINUTES = 10


def find_stranded(db: Session, minutes: int) -> list[dict]:
    """Images stuck in 'pending' with no queue message left to carry them.

    storage_path must be present: without it there is nothing for the
    detection worker to download, so republishing would only fail again.
    """
    rows = db.execute(
        text(
            """
            SELECT uuid, storage_path, camera_id, origin, ingested_at
            FROM images
            WHERE status = 'pending'
              AND storage_path IS NOT NULL
              AND ingested_at < now() - make_interval(mins => :minutes)
            ORDER BY ingested_at
            """
        ),
        {"minutes": minutes},
    ).fetchall()
    return [dict(r._mapping) for r in rows]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Republish images left stranded in 'pending' by an update."
    )
    parser.add_argument("--apply", action="store_true",
                        help="actually publish; without this it only reports")
    parser.add_argument("--minutes", type=int, default=STALE_AFTER_MINUTES,
                        help=f"how long pending counts as stranded (default {STALE_AFTER_MINUTES})")
    args = parser.parse_args()

    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        stranded = find_stranded(db, args.minutes)

    if not stranded:
        print(f"No images pending longer than {args.minutes} minutes. Nothing to do.")
        return

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"\n=== {mode}: {len(stranded)} stranded image(s) ===")

    live = RedisQueue(QUEUE_IMAGE_INGESTED)
    bulk = RedisQueue(QUEUE_IMAGE_INGESTED_BULK)

    published = 0
    for img in stranded:
        queue = bulk if img["origin"] == "bulk" else live
        print(f"  {img['uuid']}  {img['origin']:5s}  {img['ingested_at']}  -> {queue.queue_name}")
        if args.apply:
            # Same three fields ingestion publishes, see services/ingestion/main.py.
            queue.publish({
                "image_uuid": str(img["uuid"]),
                "storage_path": img["storage_path"],
                "camera_id": img["camera_id"],
            })
            published += 1

    print(f"\n=== summary ===")
    print(f"  stranded  : {len(stranded)}")
    print(f"  published : {published}")
    print(f"  mode      : {mode}")
    if not args.apply:
        print("\nRe-run with --apply to publish these.")

    logger.info(
        "Requeue pending images complete",
        stranded=len(stranded),
        published=published,
        mode=mode,
    )


if __name__ == "__main__":
    main()
