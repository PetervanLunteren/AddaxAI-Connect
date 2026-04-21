"""Add infrastructure alert toggles to server_settings

Two server-wide booleans controlling whether server admins get emailed when
the automated backup or the cold-tier migration fails. Both default TRUE so
the feature is on from the moment a new server has backup/cold-tier
configured. Runtime code also checks BACKUP_ENABLED and COLD_TIER_ENDPOINT,
so flipping either toggle only matters on servers where the feature is
actually set up.

Revision ID: 20260421_infra_alert_toggles
Revises: 20260414_captured_at_naive_local
Create Date: 2026-04-21

"""
from alembic import op
import sqlalchemy as sa


revision = '20260421_infra_alert_toggles'
down_revision = '20260414_captured_at_naive_local'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'server_settings',
        sa.Column('notify_backup_failures', sa.Boolean(),
                  nullable=False, server_default=sa.text("true")),
    )
    op.add_column(
        'server_settings',
        sa.Column('notify_cold_tier_failures', sa.Boolean(),
                  nullable=False, server_default=sa.text("true")),
    )


def downgrade():
    op.drop_column('server_settings', 'notify_cold_tier_failures')
    op.drop_column('server_settings', 'notify_backup_failures')
