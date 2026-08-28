#!/usr/bin/env python3
"""
Keep the demo project small and its dates current. Runs nightly from cron.

Two jobs, in this order:

1. Prune the project back to TARGET_SITES sites, if it has grown past that.
   Idempotent, so a restored backup gets trimmed again on the next night
   rather than leaving the demo slow until somebody notices.
2. Shift every date and timestamp forward by the number of days since the
   most recent image, so the demo always looks like it is still running.

Step 2 is a lightweight alternative to re-running populate_demo_data.py:
a few SQL UPDATEs, a few seconds, negligible RAM.

Usage:
    docker exec addaxai-api python /app/scripts/shift_demo_dates.py
"""
import sys
from datetime import date
from pathlib import Path

# Add shared module to path
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from shared.config import get_settings

PROJECT_NAME = "De Hoge Veluwe"

# How many sites the demo keeps.
#
# Every heavy dashboard query scans images, detections and classifications,
# and that cost is almost exactly linear in the row count. Measured on the
# full 62,761-image set against real subsets of it: an eighth of the data ran
# in an eighth of the time, on all four of the heaviest queries.
#
# Whole sites go rather than a sample of images. What is left then looks
# exactly like it did before: the same two years of history, the same images
# per site per day, the same species mix, the same share verified. Sampling
# images instead would have thinned every site into a trickle no real camera
# trap produces, which is the opposite of a convincing demo.
#
# Lower it for a faster demo, raise it for a busier map.
TARGET_SITES = 20

# Of those, how many may be sites where a camera was swapped.
#
# Those sites are what give the deployment timeline a story, so a few have to
# survive. But they are expensive: all nine of them together pull in 24 cameras
# and 14,528 images, because a camera that moved carries its pictures from both
# places. Keeping every one of them put a floor of 20,000 images under the demo
# whatever else was cut. Three is enough to show the feature.
SWAP_SITES_KEPT = 3


def prune_to_target_size(session: Session, project_id: int) -> bool:
    """Cut the project back to TARGET_SITES sites. Returns True if anything went.

    Removes whole sites, with their cameras, deployments, images, detections,
    classifications, observations and health reports. Sites are chosen by a
    stable hash of their name, which spreads the survivors across the map and
    across the size distribution instead of favouring the busiest ones, and
    which makes the choice the same every night, so a second run deletes
    nothing. SWAP_SITES_KEPT of them are sites where a camera was swapped, so
    the deployment timeline still has a story, and no more than that, because
    a moved camera drags its pictures from both places along with it.

    Deletion order is forced by the foreign keys: classifications, detections
    and images have NO ACTION, so they have to go by hand and in that order,
    before the cameras they hang off. Health reports, deployments, maintenance
    events and feed entries do cascade from cameras. A camera a bulk-upload job
    points at is kept whatever else happens, because that foreign key does not
    cascade either.
    """
    doomed = session.execute(
        text("""
            WITH project_sites AS (
                SELECT DISTINCT s.id, s.name
                FROM sites s
                JOIN deployments d ON d.site_id = s.id
                JOIN cameras c ON d.camera_id = c.id
                WHERE c.project_id = :pid
            ),
            swap_sites AS (
                SELECT d.site_id AS id
                FROM deployments d
                JOIN cameras c ON d.camera_id = c.id
                WHERE c.project_id = :pid AND d.site_id IS NOT NULL
                GROUP BY d.site_id
                HAVING count(*) > 1
            ),
            keep_sites AS (
                SELECT id FROM (
                    SELECT ps.id FROM project_sites ps
                    JOIN swap_sites sw ON sw.id = ps.id
                    ORDER BY md5(ps.name) LIMIT :swaps
                ) with_a_swap
                UNION
                SELECT id FROM (
                    SELECT ps.id FROM project_sites ps
                    WHERE ps.id NOT IN (SELECT id FROM swap_sites)
                    ORDER BY md5(ps.name) LIMIT :rest
                ) the_rest
            ),
            keep_cameras AS (
                SELECT DISTINCT c.id
                FROM cameras c
                JOIN deployments d ON d.camera_id = c.id
                WHERE c.project_id = :pid AND d.site_id IN (SELECT id FROM keep_sites)
                UNION
                SELECT camera_id FROM bulk_upload_jobs WHERE camera_id IS NOT NULL
            )
            SELECT c.id FROM cameras c
            WHERE c.project_id = :pid AND c.id NOT IN (SELECT id FROM keep_cameras)
        """),
        {"pid": project_id, "swaps": SWAP_SITES_KEPT, "rest": TARGET_SITES - SWAP_SITES_KEPT},
    ).scalars().all()

    if not doomed:
        print(f"Already at or below {TARGET_SITES} sites, nothing to prune.")
        return False

    print(f"Pruning to {TARGET_SITES} sites: removing {len(doomed)} camera(s)...")
    params = {"ids": list(doomed)}

    # Feed entries that point only at a doomed site would survive the camera
    # cascade with a dangling reference, so they go first.
    session.execute(
        text("""
            DELETE FROM feed_events
            WHERE site_id IN (
                SELECT d.site_id FROM deployments d
                WHERE d.camera_id = ANY(:ids) AND d.site_id IS NOT NULL
            )
        """),
        params,
    )
    session.execute(
        text("""
            DELETE FROM classifications WHERE detection_id IN (
                SELECT det.id FROM detections det
                WHERE det.image_id IN (SELECT i.id FROM images i WHERE i.camera_id = ANY(:ids))
            )
        """),
        params,
    )
    session.execute(
        text("DELETE FROM detections WHERE image_id IN (SELECT i.id FROM images i WHERE i.camera_id = ANY(:ids))"),
        params,
    )
    # human_observations cascade from images, images do not cascade from cameras.
    session.execute(text("DELETE FROM images WHERE camera_id = ANY(:ids)"), params)
    # Takes health reports, deployments, maintenance events and feed entries with it.
    session.execute(text("DELETE FROM cameras WHERE id = ANY(:ids)"), params)
    # Any site that left with nothing deployed at it.
    session.execute(text("DELETE FROM sites WHERE NOT EXISTS (SELECT 1 FROM deployments d WHERE d.site_id = sites.id)"))
    return True


def shift_dates(session: Session, project_id: int) -> None:
    """Move every date and timestamp forward so the demo looks current.

    Returns early when nothing needs moving. It is its own function so that
    early return cannot skip the space reclaim that follows a prune, which is
    exactly what it did when this lived inline in main().
    """
    row = session.execute(
        text("""
            SELECT MAX(i.captured_at::date)
            FROM images i
            JOIN cameras c ON c.id = i.camera_id
            JOIN projects p ON p.id = c.project_id
            WHERE p.name = :project
        """),
        {"project": PROJECT_NAME},
    ).one()

    most_recent = row[0]
    if most_recent is None:
        print("No images found for the demo project. Run populate_demo_data.py first.")
        return

    delta = (date.today() - most_recent).days
    if delta <= 0:
        print("No shift needed, the most recent image is dated today or later.")
        return

    print(f"Shifting demo dates forward by {delta} day(s)...")

    # Subquery that resolves the demo project's camera IDs
    demo_cameras = """
        SELECT c.id FROM cameras c
        JOIN projects p ON p.id = c.project_id
        WHERE p.name = :project
    """

    # 1) images.captured_at
    session.execute(
        text(f"""
            UPDATE images
            SET captured_at = captured_at + (:delta * INTERVAL '1 day')
            WHERE camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 2) images.image_metadata->>'DateTimeOriginal'  (EXIF format %Y:%m:%d %H:%M:%S)
    #    The column is Column(JSON) so we cast to jsonb for jsonb_set, then back.
    session.execute(
        text(f"""
            UPDATE images
            SET image_metadata = (
                jsonb_set(
                    image_metadata::jsonb,
                    '{{"DateTimeOriginal"}}',
                    to_jsonb(
                        to_char(
                            to_timestamp(
                                image_metadata->>'DateTimeOriginal',
                                'YYYY:MM:DD HH24:MI:SS'
                            ) + (:delta * INTERVAL '1 day'),
                            'YYYY:MM:DD HH24:MI:SS'
                        )
                    )
                )
            )::json
            WHERE camera_id IN ({demo_cameras})
              AND image_metadata IS NOT NULL
              AND image_metadata->>'DateTimeOriginal' IS NOT NULL
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 3) camera_health_reports.reported_at (camera clock) and created_at
    #    (server receive time). Both must move: created_at drives the
    #    camera liveness status (see shared/camera_status.py), so leaving
    #    it behind makes every demo camera look like it stopped reporting.
    #    Two-pass on reported_at to avoid transiently violating the
    #    functional unique index on (camera_id, reported_at::date): first
    #    move all timestamps to a far-future range where no collisions are
    #    possible, then move back to the correct position. created_at is
    #    not in that index, so it moves once, in the second pass.
    temp_offset = 100000
    session.execute(
        text(f"""
            UPDATE camera_health_reports
            SET reported_at = reported_at + (:offset * INTERVAL '1 day')
            WHERE camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "offset": temp_offset},
    )
    session.execute(
        text(f"""
            UPDATE camera_health_reports
            SET reported_at = reported_at + ((:delta - :offset) * INTERVAL '1 day'),
                created_at  = created_at  + (:delta * INTERVAL '1 day')
            WHERE camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "offset": temp_offset, "delta": delta},
    )

    # 4) deployments.start_date and end_date (NULL end_date = active, stays)
    session.execute(
        text(f"""
            UPDATE deployments
            SET start_date = start_date + :delta,
                end_date = end_date + :delta
            WHERE camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 5) images.ingested_at (Live feed sort key) and the human-action
    #    wall-clock stamps. NULL + interval stays NULL, so unflagged images
    #    are left alone. They track real time, staying at a fixed offset
    #    from now, so recent curation keeps looking recent.
    session.execute(
        text(f"""
            UPDATE images
            SET ingested_at     = ingested_at     + (:delta * INTERVAL '1 day'),
                verified_at     = verified_at     + (:delta * INTERVAL '1 day'),
                liked_at        = liked_at        + (:delta * INTERVAL '1 day'),
                needs_review_at = needs_review_at + (:delta * INTERVAL '1 day')
            WHERE camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 6) cameras.sim_expiry_date (keeps the "expiring soon" alert soon)
    session.execute(
        text(f"""
            UPDATE cameras
            SET sim_expiry_date = sim_expiry_date + :delta
            WHERE id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 7) human_observations.created_at
    session.execute(
        text(f"""
            UPDATE human_observations
            SET created_at = created_at + (:delta * INTERVAL '1 day')
            WHERE image_id IN (
                SELECT i.id FROM images i WHERE i.camera_id IN ({demo_cameras})
            )
        """),
        {"project": PROJECT_NAME, "delta": delta},
    )

    # 8) rejections (captured_at is naive local, rejected_at is aware UTC)
    session.execute(
        text(f"""
            UPDATE rejections
            SET rejected_at = rejected_at + (:delta * INTERVAL '1 day'),
                captured_at = captured_at + (:delta * INTERVAL '1 day')
            WHERE project_id = :pid OR camera_id IN ({demo_cameras})
        """),
        {"project": PROJECT_NAME, "delta": delta, "pid": project_id},
    )

    # 9) bulk_upload_jobs timestamps
    session.execute(
        text("""
            UPDATE bulk_upload_jobs
            SET created_at         = created_at         + (:delta * INTERVAL '1 day'),
                started_at         = started_at         + (:delta * INTERVAL '1 day'),
                process_started_at = process_started_at + (:delta * INTERVAL '1 day'),
                finished_at        = finished_at        + (:delta * INTERVAL '1 day')
            WHERE project_id = :pid
        """),
        {"delta": delta, "pid": project_id},
    )

    # 10) project_reminders (send_on is a Date, sent_at is aware UTC)
    session.execute(
        text("""
            UPDATE project_reminders
            SET send_on = send_on + :delta,
                sent_at = sent_at + (:delta * INTERVAL '1 day')
            WHERE project_id = :pid
        """),
        {"delta": delta, "pid": project_id},
    )

    # 11) camera updates feed.
    session.execute(
        text("""
            UPDATE feed_events
            SET created_at  = created_at  + (:delta * INTERVAL '1 day'),
                resolved_at = resolved_at + (:delta * INTERVAL '1 day')
            WHERE project_id = :pid
        """),
        {"delta": delta, "pid": project_id},
    )

    print(f"Done, all demo dates shifted forward by {delta} day(s).")


def main():
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)

    with Session(engine) as session:
        # Resolve the demo project id once, for the project-scoped work below.
        project_id = session.execute(
            text("SELECT id FROM projects WHERE name = :project"),
            {"project": PROJECT_NAME},
        ).scalar_one_or_none()
        if project_id is None:
            print(f"No project named {PROJECT_NAME!r}. Run populate_demo_data.py first.")
            return

        # Step 1, before the shift, so a demo that needs no shift today still
        # gets trimmed.
        pruned = prune_to_target_size(session, project_id)
        session.commit()

        # Step 2.
        shift_dates(session, project_id)
        session.commit()

    if pruned:
        # A plain DELETE leaves the pages behind, so every sequential scan
        # would still read a full-size table and the demo would be no faster.
        # VACUUM FULL rewrites them compactly. It takes an exclusive lock, but
        # this runs at 03:00 on a database of a few hundred MB, and only on the
        # night something was actually deleted.
        print("Reclaiming space...")
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            for table in ("images", "detections", "classifications",
                          "human_observations", "camera_health_reports"):
                conn.execute(text(f"VACUUM (FULL, ANALYZE) {table}"))
        print("Done, space reclaimed and statistics refreshed.")


if __name__ == "__main__":
    main()
