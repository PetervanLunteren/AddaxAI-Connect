"""Drop cameras.name; cameras are identified by device_id.

A camera no longer has a friendly name. Before dropping the column, any real
friendly name (one that is not just the device_id) is appended to the camera's
notes so the information is not lost and migrations can be spot-checked.
See future-plans/site-addition.md.

Revision ID: 20260521_drop_camera_name
Revises: 20260521_drop_camera_location
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa


revision = '20260521_drop_camera_name'
down_revision = '20260521_drop_camera_location'
branch_labels = None
depends_on = None


def upgrade():
    # Preserve real friendly names in notes (skip names that were just the
    # device_id, which carry nothing). Idempotent: never appends twice.
    op.execute("""
        UPDATE cameras
        SET notes = CASE
            WHEN notes IS NULL OR notes = '' THEN 'Previous friendly name: ' || name
            ELSE notes || E'\n\nPrevious friendly name: ' || name
        END
        WHERE name IS NOT NULL AND name <> ''
          AND (device_id IS NULL OR name <> device_id)
          AND (notes IS NULL OR notes NOT LIKE '%Previous friendly name:%')
    """)
    op.drop_column('cameras', 'name')


def downgrade():
    op.add_column(
        'cameras',
        sa.Column('name', sa.String(length=255), nullable=False, server_default=''),
    )
    op.alter_column('cameras', 'name', server_default=None)
