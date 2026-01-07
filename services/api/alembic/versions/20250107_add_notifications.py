"""Add notifications system tables

Revision ID: add_notifications
Revises: add_project_images
Create Date: 2025-01-07 12:00:00.000000

Adds three tables for notification system:
- notification_preferences: per-user notification settings
- notification_logs: audit trail for all sent notifications
- signal_config: system-wide Signal configuration (admin only)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision = 'add_notifications'
down_revision = 'add_project_images'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create notifications tables"""

    # Notification preferences table - per-user settings
    op.create_table(
        'notification_preferences',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('signal_phone', sa.String(20), nullable=True),  # E.164 format: +1234567890
        sa.Column('notify_species', JSONB, nullable=True),  # null = all species, or list like ["wolf", "bear"]
        sa.Column('notify_low_battery', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('battery_threshold', sa.Integer(), nullable=False, server_default='30'),  # Percentage
        sa.Column('notify_system_health', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )
    op.create_index('ix_notification_preferences_user_id', 'notification_preferences', ['user_id'])

    # Notification logs table - audit trail
    op.create_table(
        'notification_logs',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('notification_type', sa.String(50), nullable=False, index=True),  # species_detection, low_battery, system_health
        sa.Column('channel', sa.String(50), nullable=False, index=True),  # signal, email, sms, earthranger
        sa.Column('status', sa.String(50), nullable=False, index=True),  # pending, sent, failed
        sa.Column('trigger_data', JSONB, nullable=False),  # Event that triggered notification
        sa.Column('message_content', sa.Text(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False, index=True),
    )
    op.create_index('ix_notification_logs_user_id', 'notification_logs', ['user_id'])

    # Signal config table - system-wide configuration (single row)
    op.create_table(
        'signal_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('phone_number', sa.String(20), nullable=True),  # E.164 format
        sa.Column('device_name', sa.String(100), nullable=False, server_default='AddaxAI-Connect'),
        sa.Column('is_registered', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('health_status', sa.String(50), nullable=True),  # healthy, error, not_configured
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )


def downgrade() -> None:
    """Drop notifications tables"""
    op.drop_table('signal_config')
    op.drop_table('notification_logs')
    op.drop_table('notification_preferences')
