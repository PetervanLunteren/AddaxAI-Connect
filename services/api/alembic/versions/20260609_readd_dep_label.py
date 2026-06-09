"""Re-add deployments.name as a position label.

Reverses 20260601_drop_dep_meta for the `name` column only (not `notes`). A
deployment gets an optional free-text position label like "North" or "NW", so a
human can tell apart the several cameras at one multi-camera site, where the
device_id (a 15-digit IMEI) is not usable. The drop assumed device_id was enough
to distinguish cameras at a site; in practice it is not. Per deployment, so it
resets when a camera moves (a new deployment starts blank). backfill_sites.py
fills legacy rows from each camera's preserved friendly name.

Revision ID: 20260609_readd_dep_label
Revises: 20260601_drop_dep_meta
Create Date: 2026-06-09

"""
from alembic import op
import sqlalchemy as sa


revision = '20260609_readd_dep_label'
down_revision = '20260601_drop_dep_meta'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('deployments', sa.Column('name', sa.String(length=100), nullable=True))


def downgrade():
    op.drop_column('deployments', 'name')
