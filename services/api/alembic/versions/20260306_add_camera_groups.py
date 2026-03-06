"""Add camera groups table

Adds camera_groups table for grouping cameras that share a field of view.
Cameras in the same group share an independence interval, merging detections
of the same species across all cameras in the group.

Revision ID: 20260306_add_camera_groups
Revises: 20260217_camera_metadata
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260306_add_camera_groups'
down_revision = '20260217_camera_metadata'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'camera_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('project_id', 'name', name='uq_camera_group_project_name'),
    )
    op.create_index('ix_camera_groups_project_id', 'camera_groups', ['project_id'])

    op.add_column('cameras', sa.Column(
        'camera_group_id', sa.Integer(),
        sa.ForeignKey('camera_groups.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.create_index('ix_cameras_camera_group_id', 'cameras', ['camera_group_id'])


def downgrade():
    op.drop_index('ix_cameras_camera_group_id', table_name='cameras')
    op.drop_column('cameras', 'camera_group_id')
    op.drop_index('ix_camera_groups_project_id', table_name='camera_groups')
    op.drop_table('camera_groups')
