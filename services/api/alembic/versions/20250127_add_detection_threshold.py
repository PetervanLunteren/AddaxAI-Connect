"""Add detection_threshold to projects table

Revision ID: 20250127_add_detection_threshold
Revises: 20250125_drop_email_allowlist
Create Date: 2026-01-27

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20250127_add_detection_threshold'
down_revision = '20250125_drop_email_allowlist'
branch_labels = None
depends_on = None


def upgrade():
    """Add detection_threshold column to projects table"""
    # Add detection threshold column with default 0.5
    op.add_column(
        'projects',
        sa.Column(
            'detection_threshold',
            sa.Float(),
            nullable=False,
            server_default='0.5'
        )
    )

    # Add check constraint to ensure threshold is between 0.0 and 1.0
    op.create_check_constraint(
        'check_detection_threshold_range',
        'projects',
        'detection_threshold >= 0.0 AND detection_threshold <= 1.0'
    )


def downgrade():
    """Remove detection_threshold column from projects table"""
    # Drop check constraint
    op.drop_constraint('check_detection_threshold_range', 'projects', type_='check')

    # Drop column
    op.drop_column('projects', 'detection_threshold')
