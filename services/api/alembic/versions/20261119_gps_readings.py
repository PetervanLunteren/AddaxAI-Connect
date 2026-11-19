"""Store the GPS reading of every photo and daily report in its own columns.

Step 1a of DEPLOYMENTS_PLAN.md. Phase 2 rebuilds a camera's deployments from
its stored readings, so every reading must be in a column it can read, also
for photos taken before this update.

Photos are backfilled from what ingestion kept:

- EXIF cameras: image_metadata['gps_decimal'], a JSON array [lat, lon].
- INSTAR: no EXIF GPS, the camera's position is in its upload folder,
  kept as image_metadata['relative_path'] = 'INSTAR/lat<lat>_lon<lon>/<file>'.
  Only that first segment is read, the layout behind it changed once.

The rule for a valid reading is the one in is_valid_gps: in range and not
exactly (0, 0). Anything else stays empty. Daily reports kept no GPS history,
so their columns start empty.

Revision ID: 20261119_gps_readings
Revises: 20261118_drop_project_country
Create Date: 2026-11-19

"""
from alembic import op
import sqlalchemy as sa


revision = '20261119_gps_readings'
down_revision = '20261118_drop_project_country'
branch_labels = None
depends_on = None

# Keep in step with is_valid_gps in services/ingestion/utils.py.
VALID = "g.lat BETWEEN -90 AND 90 AND g.lon BETWEEN -180 AND 180 AND NOT (g.lat = 0 AND g.lon = 0)"


def upgrade() -> None:
    for table in ('images', 'camera_health_reports'):
        op.add_column(table, sa.Column('gps_lat', sa.Float(), nullable=True))
        op.add_column(table, sa.Column('gps_lon', sa.Float(), nullable=True))

    op.execute(f"""
        UPDATE images i
        SET gps_lat = g.lat, gps_lon = g.lon
        FROM (
            SELECT id,
                   (image_metadata->'gps_decimal'->>0)::float8 AS lat,
                   (image_metadata->'gps_decimal'->>1)::float8 AS lon
            FROM images
            WHERE json_typeof(image_metadata->'gps_decimal') = 'array'
        ) g
        WHERE i.id = g.id AND {VALID}
    """)

    op.execute(f"""
        UPDATE images i
        SET gps_lat = g.lat, gps_lon = g.lon
        FROM (
            SELECT id, m[1]::float8 AS lat, m[2]::float8 AS lon
            FROM (
                SELECT id,
                       regexp_match(
                           image_metadata->>'relative_path',
                           '^INSTAR/lat(-?\\d+\\.\\d+)_lon(-?\\d+\\.\\d+)/'
                       ) AS m
                FROM images
                WHERE image_metadata->>'source' = 'path'
            ) matched
            WHERE m IS NOT NULL
        ) g
        WHERE i.id = g.id AND {VALID}
    """)


def downgrade() -> None:
    for table in ('images', 'camera_health_reports'):
        op.drop_column(table, 'gps_lon')
        op.drop_column(table, 'gps_lat')
