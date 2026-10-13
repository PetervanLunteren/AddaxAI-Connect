"""Retired cameras: take a camera out of its project and keep its data.

One nullable timestamp on cameras. The unique index on device_id becomes
partial, live cameras only, so a retired camera keeps its id for its
history while the same device can be registered again, in another project
or the same one.

Revision ID: 20261013_camera_retired_at
Revises: 20261012_privacy_removal
Create Date: 2026-10-13

"""
from alembic import op
import sqlalchemy as sa


revision = '20261013_camera_retired_at'
down_revision = '20261012_privacy_removal'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'cameras',
        sa.Column('retired_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_index('ix_cameras_device_id', table_name='cameras')
    op.create_index(
        'ix_cameras_device_id', 'cameras', ['device_id'],
        unique=True, postgresql_where=sa.text('retired_at IS NULL'),
    )


def downgrade() -> None:
    # Fails when two rows share a device id, which is the point: a retired
    # camera and its re-registration cannot both exist under the old rule.
    op.drop_index('ix_cameras_device_id', table_name='cameras')
    op.create_index('ix_cameras_device_id', 'cameras', ['device_id'], unique=True)
    op.drop_column('cameras', 'retired_at')
