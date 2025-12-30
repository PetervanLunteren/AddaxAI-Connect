"""Add camera inventory fields for CSV import

Revision ID: add_camera_inventory
Revises: add_raw_predictions_and_projects
Create Date: 2025-12-30 14:00:00.000000

Adds fields for camera inventory management:
- box: Storage box identifier
- order: Order/sequence number (text field)
- scanned_date: Date when camera was scanned into inventory
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_camera_inventory'
down_revision = 'rename_species_filter'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add inventory tracking fields to cameras table"""
    op.add_column('cameras', sa.Column('box', sa.String(100), nullable=True))
    op.add_column('cameras', sa.Column('order', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('scanned_date', sa.Date(), nullable=True))


def downgrade() -> None:
    """Remove inventory tracking fields from cameras table"""
    op.drop_column('cameras', 'scanned_date')
    op.drop_column('cameras', 'order')
    op.drop_column('cameras', 'box')
