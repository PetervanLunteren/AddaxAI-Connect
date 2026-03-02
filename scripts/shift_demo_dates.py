#!/usr/bin/env python3
"""
Shift all demo data dates forward so the demo stays current.

Lightweight alternative to re-running populate_demo_data.py — executes 6 SQL
UPDATEs to advance every date/timestamp column by the number of days since
the most recent image was uploaded.  Runs in <5 seconds with negligible RAM.

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
                SELECT MAX(i.uploaded_at::date)
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

        # Subquery that resolves the demo project's camera IDs
        demo_cameras = """
            SELECT c.id FROM cameras c
            JOIN projects p ON p.id = c.project_id
            WHERE p.name = :project
        """

        # 1) images.uploaded_at
        session.execute(
            text(f"""
                UPDATE images
                SET uploaded_at = uploaded_at + (:delta * INTERVAL '1 day')
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

        # 3) camera_health_reports.report_date  (date + integer in PostgreSQL)
        session.execute(
            text(f"""
                UPDATE camera_health_reports
                SET report_date = report_date + :delta
                WHERE camera_id IN ({demo_cameras})
            """),
            {"project": PROJECT_NAME, "delta": delta},
        )

        # 4) cameras.last_seen, last_image_at, last_daily_report_at
        session.execute(
            text(f"""
                UPDATE cameras
                SET last_seen           = last_seen           + (:delta * INTERVAL '1 day'),
                    last_image_at       = last_image_at       + (:delta * INTERVAL '1 day'),
                    last_daily_report_at = last_daily_report_at + (:delta * INTERVAL '1 day')
                WHERE id IN ({demo_cameras})
            """),
            {"project": PROJECT_NAME, "delta": delta},
        )

        # 5) cameras.config->>'last_report_timestamp'  (ISO 8601 string inside JSON)
        session.execute(
            text(f"""
                UPDATE cameras
                SET config = (
                    jsonb_set(
                        config::jsonb,
                        '{{"last_report_timestamp"}}',
                        to_jsonb(
                            to_char(
                                (config->>'last_report_timestamp')::timestamptz
                                    + (:delta * INTERVAL '1 day'),
                                'YYYY-MM-DD"T"HH24:MI:SS+00:00'
                            )
                        )
                    )
                )::json
                WHERE id IN ({demo_cameras})
                  AND config IS NOT NULL
                  AND config->>'last_report_timestamp' IS NOT NULL
            """),
            {"project": PROJECT_NAME, "delta": delta},
        )

        # 6) camera_deployment_periods.start_date
        session.execute(
            text(f"""
                UPDATE camera_deployment_periods
                SET start_date = start_date + :delta
                WHERE camera_id IN ({demo_cameras})
            """),
            {"project": PROJECT_NAME, "delta": delta},
        )

        session.commit()
        print(f"Done — all demo dates shifted forward by {delta} day(s).")


if __name__ == "__main__":
    main()
