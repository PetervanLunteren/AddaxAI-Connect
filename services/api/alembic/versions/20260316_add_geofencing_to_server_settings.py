"""Add geofencing columns to server_settings

Stores SpeciesNet country code and admin1 region for ensemble
geofencing. Configured via the admin UI instead of env vars.

Revision ID: 20260316_add_geofencing
Revises: 20260314_add_taxonomy_mapping
Create Date: 2026-03-16

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260316_add_geofencing'
down_revision = '20260314_add_taxonomy_mapping'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('server_settings', sa.Column('speciesnet_country_code', sa.String(10), nullable=True))
    op.add_column('server_settings', sa.Column('speciesnet_admin1_region', sa.String(20), nullable=True))


def downgrade():
    op.drop_column('server_settings', 'speciesnet_admin1_region')
    op.drop_column('server_settings', 'speciesnet_country_code')
