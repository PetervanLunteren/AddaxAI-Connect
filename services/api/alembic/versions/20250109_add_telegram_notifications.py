"""Add Telegram notification support

Revision ID: add_telegram_notifications
Revises: convert_to_project_notifications
Create Date: 2025-01-09 14:00:00.000000

Adds Telegram as a notification channel alongside Signal, with per-notification-type
channel selection via JSON structure.

Changes:
- Add telegram_chat_id column to project_notification_preferences
- Add notification_channels JSON column for per-type channel selection
- Create telegram_config table for bot configuration
- Migrate existing preferences to new JSON structure
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = 'add_telegram_notifications'
down_revision = 'convert_to_project_notifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add Telegram notification support"""

    # Add telegram_chat_id column
    op.add_column(
        'project_notification_preferences',
        sa.Column('telegram_chat_id', sa.String(50), nullable=True)
    )

    # Add notification_channels JSON column
    # This will store per-notification-type channel preferences
    op.add_column(
        'project_notification_preferences',
        sa.Column('notification_channels', JSONB, nullable=True)
    )

    # Create telegram_config table
    op.create_table(
        'telegram_config',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('bot_token', sa.String(100), nullable=True),
        sa.Column('bot_username', sa.String(100), nullable=True),
        sa.Column('is_configured', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('health_status', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )

    # Migrate existing preferences to new JSON structure
    # Build notification_channels JSON from existing boolean flags
    connection = op.get_bind()
    connection.execute(text("""
        UPDATE project_notification_preferences
        SET notification_channels = jsonb_build_object(
            'species_detection', jsonb_build_object(
                'enabled', CASE WHEN signal_phone IS NOT NULL THEN true ELSE false END,
                'channels', CASE
                    WHEN signal_phone IS NOT NULL THEN '["signal"]'::jsonb
                    ELSE '[]'::jsonb
                END,
                'notify_species', COALESCE(notify_species, 'null'::jsonb)
            ),
            'battery_digest', jsonb_build_object(
                'enabled', notify_low_battery,
                'channels', CASE
                    WHEN signal_phone IS NOT NULL AND notify_low_battery THEN '["signal"]'::jsonb
                    ELSE '[]'::jsonb
                END,
                'battery_threshold', battery_threshold
            ),
            'system_health', jsonb_build_object(
                'enabled', notify_system_health,
                'channels', CASE
                    WHEN signal_phone IS NOT NULL AND notify_system_health THEN '["signal"]'::jsonb
                    ELSE '[]'::jsonb
                END
            )
        )
        WHERE notification_channels IS NULL
    """))


def downgrade() -> None:
    """Remove Telegram notification support"""

    # Drop telegram_config table
    op.drop_table('telegram_config')

    # Drop new columns
    op.drop_column('project_notification_preferences', 'notification_channels')
    op.drop_column('project_notification_preferences', 'telegram_chat_id')
