"""Whether a person set a deployment's last day.

Effort (trap-days) counts a deployment to its last photo, unless a person
typed its last day: then it counts to that day. Until now the rule read
site_source = 'manual' for that, which also holds for a deployment whose
site alone was changed, for "It stayed" and for carried-over history, where
the GPS made the last day. last_day_set says exactly what the rule needs.

The rebuild writes it (shared/deployment_rebuild.py). False for every
existing row: the carry-over of this release rebuilds every camera once,
which sets it.

Revision ID: 20261127_deployment_last_day_set
Revises: 20261125_statement_changes
Create Date: 2026-11-27

"""
from alembic import op
import sqlalchemy as sa


revision = '20261127_deployment_last_day_set'
down_revision = '20261125_statement_changes'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'deployments',
        sa.Column('last_day_set', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('deployments', 'last_day_set')
