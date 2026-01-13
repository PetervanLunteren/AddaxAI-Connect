"""remove signal support

Revision ID: 20250113_remove_signal_support
Revises: 20250109_add_telegram_notifications
Create Date: 2025-01-13

Removes all Signal-related columns and tables:
- Drops signal_phone column from project_notification_preferences
- Drops signal_config table entirely
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '20250113_remove_signal_support'
down_revision = 'add_telegram_notifications'
branch_labels = None
depends_on = None


def upgrade():
    # Drop signal_phone column from project_notification_preferences
    op.drop_column('project_notification_preferences', 'signal_phone')

    # Drop signal_config table
    op.drop_table('signal_config')


def downgrade():
    # Recreate signal_config table
    op.create_table(
        'signal_config',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('phone_number', sa.String(20), nullable=True),
        sa.Column('device_name', sa.String(100), nullable=False),
        sa.Column('is_registered', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('health_status', sa.String(50), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Re-add signal_phone column to project_notification_preferences
    op.add_column('project_notification_preferences',
                  sa.Column('signal_phone', sa.String(20), nullable=True))
