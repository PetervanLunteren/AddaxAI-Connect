"""Add the security alert toggle to server_settings

One server-wide boolean controlling whether server admins get emailed when the
daily security check fails. Defaults TRUE so the alert is on from the moment a
server is updated. Server-wide and not per project on purpose: the security
state belongs to the machine, and only a server admin can act on it.

Revision ID: 20260818_security_alert_toggle
Revises: 20260812_theft_watch_rules
Create Date: 2026-08-18

"""
from alembic import op
import sqlalchemy as sa


revision = '20260818_security_alert_toggle'
down_revision = '20260812_theft_watch_rules'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'server_settings',
        sa.Column('notify_security_failures', sa.Boolean(),
                  nullable=False, server_default=sa.text("true")),
    )


def downgrade():
    op.drop_column('server_settings', 'notify_security_failures')
