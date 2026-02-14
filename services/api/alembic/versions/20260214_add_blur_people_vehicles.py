"""Add blur_people_vehicles to projects table

Per-project privacy setting to automatically blur detected people and vehicles
in all images. Enabled by default for privacy protection.

Revision ID: 20260214_add_blur_people_vehicles
Revises: 20260213_add_project_timezone
Create Date: 2026-02-14

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260214_add_blur_people_vehicles'
down_revision = '20260213_add_project_timezone'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'projects',
        sa.Column(
            'blur_people_vehicles',
            sa.Boolean(),
            nullable=False,
            server_default='true'
        )
    )


def downgrade():
    op.drop_column('projects', 'blur_people_vehicles')
