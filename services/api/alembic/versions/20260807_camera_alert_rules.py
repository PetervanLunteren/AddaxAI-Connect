"""Add camera_alert_rules, drop the dead alert tables

User-defined camera condition alerts (battery below a threshold, SD card
filling up, camera silent for days), private per user, evaluated by a
daily cron. Fires once per incident via notified_camera_ids and re-arms
when a camera recovers.

Also drops alert_rules and alert_logs. They were created in the initial
schema for a planned alerts service that never ran; nothing ever read or
wrote them and they are empty on every deployment.

Revision ID: 20260807_camera_alert_rules
Revises: 20260807_add_image_tags
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa


revision = '20260807_camera_alert_rules'
down_revision = '20260807_add_image_tags'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'camera_alert_rules',
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
        sa.Column('rule_type', sa.String(length=20), nullable=False),
        sa.Column('threshold', sa.Integer(), nullable=False),
        sa.Column('camera_ids', sa.JSON(), nullable=True),
        sa.Column('channels', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('notified_camera_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    # alert_logs references alert_rules, so it goes first
    op.drop_table('alert_logs')
    op.drop_table('alert_rules')


def downgrade():
    op.drop_table('camera_alert_rules')

    # Recreate the dead tables in their initial-schema shape (empty)
    op.create_table(
        'alert_rules',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('rule_type', sa.String(length=50), nullable=False),
        sa.Column('condition', sa.JSON(), nullable=False),
        sa.Column('notification_method', sa.String(length=50), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        'alert_logs',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('rule_id', sa.Integer(), sa.ForeignKey('alert_rules.id'), nullable=False),
        sa.Column('triggered_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
    )
