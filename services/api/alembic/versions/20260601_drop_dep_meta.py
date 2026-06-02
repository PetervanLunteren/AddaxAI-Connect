"""Drop deployments.name and deployments.notes.

Deployments carry no free-text metadata. The model is (camera, site, time
range, location, site_source); the only human input is the site assignment.
Cameras at one site are distinguished by device_id. See the audit in
future-plans/site-addition.md history.

Revision ID: 20260601_drop_dep_meta
Revises: 20260528_dep_site_source
Create Date: 2026-06-01

"""
from alembic import op
import sqlalchemy as sa


revision = '20260601_drop_dep_meta'
down_revision = '20260528_dep_site_source'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('deployments', 'name')
    op.drop_column('deployments', 'notes')


def downgrade():
    op.add_column('deployments', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('deployments', sa.Column('name', sa.String(length=100), nullable=True))
