"""Privacy removal: delete photos of people and vehicles instead of storing them.

Two project flags next to the blur flags, off by default so every existing
project keeps its photos. One timestamp on images that records when the
photo was replaced by the placeholder (see shared/privacy.py); null means
the real photo is in storage.

Revision ID: 20261012_privacy_removal
Revises: 20261009_camera_service_tasks
Create Date: 2026-10-12

"""
from alembic import op
import sqlalchemy as sa


revision = '20261012_privacy_removal'
down_revision = '20261009_camera_service_tasks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column('delete_people', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'projects',
        sa.Column('delete_vehicles', sa.Boolean(), nullable=False, server_default='false'),
    )
    op.add_column(
        'images',
        sa.Column('privacy_removed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('images', 'privacy_removed_at')
    op.drop_column('projects', 'delete_vehicles')
    op.drop_column('projects', 'delete_people')
