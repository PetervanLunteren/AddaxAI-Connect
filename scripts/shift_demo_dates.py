#!/usr/bin/env python3
"""
Shift all demo data dates forward so the demo stays current.

Lightweight alternative to re-running populate_demo_data.py: executes a few
SQL UPDATEs to advance every date/timestamp column by the number of days
since the most recent image was captured. Runs in <5 seconds with negligible
RAM.

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


def main():
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)

    with Session(engine) as session:
        # --- Determine the shift delta ----------------------------------
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
            print("No images found for demo project — run populate_demo_data.py first.")
            return

        delta = (date.today() - most_recent).days
        if delta <= 0:
            print("No shift needed (most recent image date is today or in the future).")
            return

        print(f"Shifting demo dates forward by {delta} day(s)...")

        # Resolve the demo project id once, for the project-scoped tables below.
        project_id = session.execute(
            text("SELECT id FROM projects WHERE name = :project"),
            {"project": PROJECT_NAME},
        ).scalar_one()

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

        # 3) camera_health_reports.reported_at
        #    Two-pass to avoid transiently violating the functional unique
        #    index on (camera_id, reported_at::date): first move all
        #    timestamps to a far-future range where no collisions are
        #    possible, then move back to the correct position.
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
                SET reported_at = reported_at + ((:delta - :offset) * INTERVAL '1 day')
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

        session.commit()
        print(f"Done — all demo dates shifted forward by {delta} day(s).")


if __name__ == "__main__":
    main()
