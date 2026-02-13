"""Add timezone to projects table

Stores IANA timezone name per project for export timestamps and activity charts.
Defaults to UTC for existing projects.

Revision ID: 20260213_add_project_timezone
Revises: 20260206_add_species_taxonomy
Create Date: 2026-02-13

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260213_add_project_timezone'
down_revision = '20260206_add_species_taxonomy'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'projects',
        sa.Column(
            'timezone',
            sa.String(50),
            nullable=False,
            server_default='UTC'
        )
    )


def downgrade():
    op.drop_column('projects', 'timezone')
