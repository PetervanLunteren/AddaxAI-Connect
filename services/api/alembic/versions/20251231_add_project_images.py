"""Add project image fields

Revision ID: add_project_images
Revises: add_camera_inventory
Create Date: 2025-12-31 09:00:00.000000

Adds fields for project images and thumbnails:
- image_path: MinIO path to original project image
- thumbnail_path: MinIO path to thumbnail (256x256)
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_project_images'
down_revision = 'add_camera_inventory'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add image fields to projects table"""
    op.add_column('projects', sa.Column('image_path', sa.String(512), nullable=True))
    op.add_column('projects', sa.Column('thumbnail_path', sa.String(512), nullable=True))


def downgrade() -> None:
    """Remove image fields from projects table"""
    op.drop_column('projects', 'thumbnail_path')
    op.drop_column('projects', 'image_path')
