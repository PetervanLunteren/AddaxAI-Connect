"""Add thumbnail_path to images and remove crop_path from detections

Revision ID: add_thumb_rm_crop
Revises: add_category_det
Create Date: 2025-12-18 14:15:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_thumb_rm_crop'
down_revision = 'add_category_det'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add thumbnail_path to images, remove crop_path from detections"""
    # Add thumbnail_path column to images table
    op.add_column('images', sa.Column('thumbnail_path', sa.String(length=512), nullable=True))

    # Remove crop_path column from detections table
    op.drop_column('detections', 'crop_path')


def downgrade() -> None:
    """Remove thumbnail_path from images, restore crop_path to detections"""
    # Remove thumbnail_path column from images table
    op.drop_column('images', 'thumbnail_path')

    # Restore crop_path column to detections table
    op.add_column('detections', sa.Column('crop_path', sa.String(length=512), nullable=True))
