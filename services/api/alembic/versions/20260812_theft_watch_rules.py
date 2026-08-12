"""Add theft_watch_rules

Theft watch (beta) becomes the fourth per-user rule type. One rule
carries two triggers, a real-time person outlier alert and an hourly
adaptive silence alert, with a low/medium/high sensitivity preset. No
seeding, the feature is new.

Revision ID: 20260812_theft_watch_rules
Revises: 20260811_scheduled_report_rules
Create Date: 2026-08-12

"""
from alembic import op
import sqlalchemy as sa


revision = '20260812_theft_watch_rules'
down_revision = '20260811_scheduled_report_rules'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'theft_watch_rules',
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
        sa.Column('sensitivity', sa.String(length=10), nullable=False),
        sa.Column('site_ids', sa.JSON(), nullable=True),
        sa.Column('channels', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('person_cooldown_state', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('notified_camera_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('theft_watch_rules')
