"""Rename cameras.imei to cameras.device_id

Generalize the unique camera identifier from IMEI-specific to support
any device ID (IMEI, serial number, or custom identifier).

Revision ID: 20260309_rename_imei
Revises: 20260306_add_camera_groups
Create Date: 2026-03-09

"""
from alembic import op

# revision identifiers, used by Alembic
revision = '20260309_rename_imei'
down_revision = '20260306_add_camera_groups'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column('cameras', 'imei', new_column_name='device_id')
    op.execute('ALTER INDEX ix_cameras_imei RENAME TO ix_cameras_device_id')


def downgrade():
    op.alter_column('cameras', 'device_id', new_column_name='imei')
    op.execute('ALTER INDEX ix_cameras_device_id RENAME TO ix_cameras_imei')
