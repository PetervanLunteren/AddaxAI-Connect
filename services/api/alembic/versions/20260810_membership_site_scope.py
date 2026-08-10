"""Add site_ids to project memberships and user invitations

A project-viewer membership can optionally be restricted to a subset of
the project's sites. Null means all sites, which is the behaviour of
every existing row, so no backfill is needed. A non-empty list restricts
the viewer to those sites. An empty list is rejected at validation so
"all sites" has exactly one representation, the same convention as
DetectionAlertRule.site_ids.

The invitation carries the same column so a scope chosen at invite time
survives the register-later flow.

Revision ID: 20260810_membership_site_scope
Revises: 20260809_detection_alert_rules
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa


revision = '20260810_membership_site_scope'
down_revision = '20260809_detection_alert_rules'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('project_memberships', sa.Column('site_ids', sa.JSON(), nullable=True))
    op.add_column('user_invitations', sa.Column('site_ids', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('user_invitations', 'site_ids')
    op.drop_column('project_memberships', 'site_ids')
