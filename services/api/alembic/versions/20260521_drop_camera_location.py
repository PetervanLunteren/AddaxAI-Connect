"""Drop the redundant cameras.location column.

Location now lives on Site (the place) and Deployment (the exact spot a camera
sat). A camera's location is whatever its current deployment's site is, so the
denormalised cameras.location column is no longer needed. See
future-plans/site-addition.md.

Dropping the column also drops its PostGIS spatial index automatically.

Revision ID: 20260521_drop_camera_location
Revises: 20260520_add_sites
Create Date: 2026-05-21

"""
from alembic import op


revision = '20260521_drop_camera_location'
down_revision = '20260520_add_sites'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE cameras DROP COLUMN IF EXISTS location")


def downgrade():
    op.execute("ALTER TABLE cameras ADD COLUMN location geography(Point,4326)")
    op.execute("CREATE INDEX idx_cameras_location ON cameras USING gist (location)")
