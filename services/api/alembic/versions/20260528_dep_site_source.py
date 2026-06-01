"""Add site_source to deployments.

Marks whether a deployment's site was assigned automatically by GPS clustering
('auto') or by a human ('manual'). A manual assignment is sticky: ingestion must
not re-resolve or heal the site for it. Existing rows backfill to 'auto'. See
future-plans/site-addition.md.

Revision ID: 20260528_dep_site_source
Revises: 20260521_add_deployment_notes
Create Date: 2026-05-28

"""
from alembic import op
import sqlalchemy as sa


revision = '20260528_dep_site_source'
down_revision = '20260521_add_deployment_notes'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'deployments',
        sa.Column('site_source', sa.String(length=16), nullable=False, server_default='auto'),
    )


def downgrade():
    op.drop_column('deployments', 'site_source')
