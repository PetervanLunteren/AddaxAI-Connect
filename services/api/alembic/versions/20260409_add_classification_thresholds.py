"""Add classification_thresholds to projects

Adds an optional JSON column for per-species classification confidence
thresholds. Shape: {"default": float, "overrides": {species: float}}.
Null = no classification filtering applied (the same as default 0.0),
which preserves existing behaviour for every project on day one.

Revision ID: 20260409_add_class_thresh
Revises: 20260319_drop_report_email
Create Date: 2026-04-09

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260409_add_class_thresh'
down_revision = '20260319_drop_report_email'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column(
        'classification_thresholds', sa.JSON(), nullable=True
    ))


def downgrade():
    op.drop_column('projects', 'classification_thresholds')
