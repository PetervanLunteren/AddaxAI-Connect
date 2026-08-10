"""Add camera maintenance events, drop the dead last_maintenance_at column

One row per maintenance visit to a camera: a date, a list of actions
from a fixed vocabulary, who performed it, and an optional note. The
"last maintenance" values shown in the UI and export derive from
max(event_date) per camera, so no summary column is stored.

cameras.last_maintenance_at existed since the initial schema but was
never written by any code path, only read into a permanently empty
export column. It is replaced by the derived value, so the column goes.

Revision ID: 20260810_camera_maintenance
Revises: 20260810_membership_site_scope
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa


revision = '20260810_camera_maintenance'
down_revision = '20260810_membership_site_scope'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'camera_maintenance_events',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('camera_id', sa.Integer(), sa.ForeignKey('cameras.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('event_date', sa.Date(), nullable=False, index=True),
        sa.Column('action_types', sa.JSON(), nullable=False),
        sa.Column('performed_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.drop_column('cameras', 'last_maintenance_at')


def downgrade() -> None:
    op.add_column('cameras', sa.Column('last_maintenance_at', sa.DateTime(timezone=True), nullable=True))
    op.drop_table('camera_maintenance_events')
