"""Add scheduled_report_rules

Scheduled species reports become the third per-user rule type, after the
camera condition alert rules and the detection alert rules. A rule names
its species and a frequency (weekly, monthly, or quarterly); the
notifications worker emails the creator one analytical report per period.
No seeding, the feature is new.

Revision ID: 20260811_scheduled_report_rules
Revises: 20260810_camera_maintenance
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa


revision = '20260811_scheduled_report_rules'
down_revision = '20260810_camera_maintenance'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'scheduled_report_rules',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column(
            'project_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('species', sa.JSON(), nullable=False),
        sa.Column('frequency', sa.String(length=10), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('scheduled_report_rules')
