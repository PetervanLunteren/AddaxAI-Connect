"""Country per project: move the SpeciesNet geofence location off the server.

A server can host projects in several countries, so the country (ISO 3166-1
alpha-3) and the optional US state (ISO 3166-2, "US-CA") live on the
project. Both nullable: new projects must set a country (enforced by the API).
A SpeciesNet server had one country for all its projects, so every project
gets that one; on a DeepFaune server the country was never set and the
projects stay empty. Then the server-level columns go.

Revision ID: 20261014_project_country
Revises: 20261013_camera_retired_at
Create Date: 2026-10-14

"""
from alembic import op
import sqlalchemy as sa


revision = '20261014_project_country'
down_revision = '20261013_camera_retired_at'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('country_code', sa.String(3), nullable=True))
    op.add_column('projects', sa.Column('admin1_region', sa.String(10), nullable=True))
    op.execute("""
        UPDATE projects
        SET country_code = s.speciesnet_country_code, admin1_region = s.speciesnet_admin1_region
        FROM server_settings s
        WHERE s.speciesnet_country_code IS NOT NULL
    """)
    op.drop_column('server_settings', 'speciesnet_country_code')
    op.drop_column('server_settings', 'speciesnet_admin1_region')


def downgrade() -> None:
    op.add_column('server_settings', sa.Column('speciesnet_admin1_region', sa.String(20), nullable=True))
    op.add_column('server_settings', sa.Column('speciesnet_country_code', sa.String(10), nullable=True))
    op.drop_column('projects', 'admin1_region')
    op.drop_column('projects', 'country_code')
