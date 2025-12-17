"""Add category to detections

Revision ID: add_category_det
Revises: 3d450ba35253
Create Date: 2025-12-17 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_category_det'
down_revision = '3d450ba35253'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add category column to detections table"""
    # Add category column (animal, person, vehicle)
    op.add_column('detections', sa.Column('category', sa.String(length=50), nullable=True))


def downgrade() -> None:
    """Remove category column from detections table"""
    op.drop_column('detections', 'category')
