"""Switch image capture time to naive local and clean up camera/health columns

Converts images.uploaded_at (TIMESTAMPTZ, mistagged as UTC) to images.captured_at
(naive TIMESTAMP), interpreted under ServerSettings.timezone. Drops the dead
Camera.last_* camera-clock columns (never written by production ingestion, the
API computes them live via MAX(images.captured_at)). Promotes
camera_health_reports.report_date (DATE, time component discarded) to
camera_health_reports.reported_at (naive TIMESTAMP, preserves the hour from
the daily report).

Existing image rows are all from Willfine cameras, which were written naive
and then mistagged by PostgreSQL with the Docker session TZ (UTC). Stripping
the fake UTC tag with `AT TIME ZONE 'UTC'` recovers the camera wall-clock for
every row.

Revision ID: 20260414_captured_at_naive_local
Revises: 20260414_add_camera_ref_image
Create Date: 2026-04-14

"""
from alembic import op
import sqlalchemy as sa


revision = '20260414_captured_at_naive_local'
down_revision = '20260414_add_camera_ref_image'
branch_labels = None
depends_on = None


def upgrade():
    # 1. images.uploaded_at -> images.captured_at, TIMESTAMPTZ -> TIMESTAMP.
    op.execute("ALTER INDEX ix_images_uploaded_at RENAME TO ix_images_captured_at")
    op.alter_column('images', 'uploaded_at', new_column_name='captured_at')
    op.execute(
        "ALTER TABLE images "
        "ALTER COLUMN captured_at TYPE TIMESTAMP WITHOUT TIME ZONE "
        "USING captured_at AT TIME ZONE 'UTC'"
    )
    # Capture time must come from the camera, not the DB clock, so drop the default.
    op.execute("ALTER TABLE images ALTER COLUMN captured_at DROP DEFAULT")

    # 2. Drop dead camera-clock columns. The API computes "last image" live.
    op.drop_index('ix_cameras_last_seen', table_name='cameras')
    op.drop_column('cameras', 'last_seen')
    op.drop_column('cameras', 'last_image_at')
    op.drop_column('cameras', 'last_daily_report_at')

    # 3. camera_health_reports.report_date (DATE) -> reported_at (TIMESTAMP).
    op.drop_index('idx_health_report_date', table_name='camera_health_reports')
    op.drop_index('idx_health_report_camera_date', table_name='camera_health_reports')
    op.drop_constraint('uq_camera_report_date', 'camera_health_reports', type_='unique')
    op.add_column(
        'camera_health_reports',
        sa.Column('reported_at', sa.DateTime(timezone=False), nullable=True),
    )
    # Existing rows only have a date, so promote to midnight local time.
    op.execute("UPDATE camera_health_reports SET reported_at = report_date::timestamp")
    op.alter_column('camera_health_reports', 'reported_at', nullable=False)
    op.drop_column('camera_health_reports', 'report_date')
    op.create_index(
        'ix_camera_health_reports_reported_at',
        'camera_health_reports',
        ['reported_at'],
        unique=False,
    )
    op.create_index(
        'ix_camera_health_reports_camera_reported_at',
        'camera_health_reports',
        ['camera_id', 'reported_at'],
        unique=False,
    )
    # Functional unique index keeps one-report-per-camera-per-day.
    op.execute(
        "CREATE UNIQUE INDEX uq_camera_report_day "
        "ON camera_health_reports (camera_id, (reported_at::date))"
    )


def downgrade():
    # Forward-only: reversing this migration would lose the camera wall-clock
    # time component on health reports and cannot reconstruct the dead camera
    # columns. Per CONVENTIONS rule 5 the project has no backward compatibility
    # requirement, so no downgrade is provided.
    raise NotImplementedError("Forward-only migration")
