"""Country per project: move the SpeciesNet geofence location off the server.

A server can host projects in several countries, so the country (ISO 3166-1
alpha-3) and the optional US state (ISO 3166-2, "US-CA") live on the
project. Both nullable: new projects must set a country (enforced by the API),
existing projects stay empty, there is no backfill. The server-level columns
go; only SpeciesNet read them and no production server runs SpeciesNet.

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
    op.drop_column('server_settings', 'speciesnet_country_code')
    op.drop_column('server_settings', 'speciesnet_admin1_region')


def downgrade() -> None:
    op.add_column('server_settings', sa.Column('speciesnet_admin1_region', sa.String(20), nullable=True))
    op.add_column('server_settings', sa.Column('speciesnet_country_code', sa.String(10), nullable=True))
    op.drop_column('projects', 'admin1_region')
    op.drop_column('projects', 'country_code')
