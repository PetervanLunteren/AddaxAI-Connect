"""Convert to project-based notification preferences

Revision ID: convert_to_project_notifications
Revises: add_notifications
Create Date: 2025-01-09 12:00:00.000000

Converts from per-user notification preferences to per-user-per-project preferences.
This allows users to have different notification settings for each project they access.

Changes:
- Drop notification_preferences table
- Create project_notification_preferences table with user_id + project_id composite unique key
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = 'convert_to_project_notifications'
down_revision = 'add_notifications'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Convert to project-based notification preferences"""

    # Drop old notification_preferences table
    op.drop_table('notification_preferences')

    # Create new project_notification_preferences table
    op.create_table(
        'project_notification_preferences',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('signal_phone', sa.String(20), nullable=True),  # E.164 format: +1234567890
        sa.Column('notify_species', JSONB, nullable=True),  # null = all species, or list like ["wolf", "bear"]
        sa.Column('notify_low_battery', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('battery_threshold', sa.Integer(), nullable=False, server_default='30'),  # Percentage
        sa.Column('notify_system_health', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )

    # Create indexes
    op.create_index('ix_project_notification_preferences_user_id', 'project_notification_preferences', ['user_id'])
    op.create_index('ix_project_notification_preferences_project_id', 'project_notification_preferences', ['project_id'])

    # Create unique constraint on (user_id, project_id)
    op.create_unique_constraint(
        'uq_user_project_notification',
        'project_notification_preferences',
        ['user_id', 'project_id']
    )


def downgrade() -> None:
    """Revert to user-level notification preferences"""

    # Drop new table
    op.drop_table('project_notification_preferences')

    # Recreate old notification_preferences table
    op.create_table(
        'notification_preferences',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('signal_phone', sa.String(20), nullable=True),
        sa.Column('notify_species', JSONB, nullable=True),
        sa.Column('notify_low_battery', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('battery_threshold', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('notify_system_health', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.func.now(), nullable=True),
    )
    op.create_index('ix_notification_preferences_user_id', 'notification_preferences', ['user_id'])
