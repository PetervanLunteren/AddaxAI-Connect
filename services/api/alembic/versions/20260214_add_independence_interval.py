"""Add independence_interval_minutes to projects

Adds a per-project independence interval setting for grouping
detections of the same species at the same camera within N minutes
as a single event. Default 0 = disabled (existing behavior).

Revision ID: 20260214_add_indep_interval
Revises: 20260214_tz_to_server_settings
Create Date: 2026-02-14

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260214_add_indep_interval'
down_revision = '20260214_tz_to_server_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('projects', sa.Column(
        'independence_interval_minutes', sa.Integer(),
        nullable=False, server_default='0'
    ))


def downgrade():
    op.drop_column('projects', 'independence_interval_minutes')
