"""Add camera service tasks, planned service visits per camera

One row per open task: the camera, the actions to do (same vocabulary
as the service log), an optional note, due date and assignee. A task
is deleted when it is completed (it becomes a camera_maintenance_events
row) or cancelled, so the table only ever holds open work and needs no
status column.

Revision ID: 20261009_camera_service_tasks
Revises: 20261007_bulk_time_offset
Create Date: 2026-10-09

"""
from alembic import op
import sqlalchemy as sa


revision = '20261009_camera_service_tasks'
down_revision = '20261007_bulk_time_offset'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'camera_service_tasks',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('camera_id', sa.Integer(), sa.ForeignKey('cameras.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('action_types', sa.JSON(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True, index=True),
        sa.Column('assigned_to_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('camera_service_tasks')
