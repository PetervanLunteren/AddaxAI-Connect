"""Initial schema with role-based access control

Revision ID: 20250114_initial_schema
Revises:
Create Date: 2025-01-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import geoalchemy2

# revision identifiers, used by Alembic.
revision = '20250114_initial_schema'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Users table (with is_server_admin from the start)
    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_server_admin', sa.Boolean(), nullable=False),
        sa.Column('is_verified', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    # Email allowlist (with is_server_admin from the start)
    op.create_table('email_allowlist',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('is_server_admin', sa.Boolean(), nullable=False),
        sa.Column('added_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['added_by_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_index(op.f('ix_email_allowlist_id'), 'email_allowlist', ['id'], unique=False)

    # Projects table
    op.create_table('projects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', geoalchemy2.types.Geography(geometry_type='POLYGON', srid=4326, dimension=2, from_text='ST_GeogFromText', name='geography'), nullable=True),
        sa.Column('included_species', sa.JSON(), nullable=True),
        sa.Column('image_path', sa.String(length=512), nullable=True),
        sa.Column('thumbnail_path', sa.String(length=512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_projects_id'), 'projects', ['id'], unique=False)

    # Project memberships table (role-based access control)
    op.create_table('project_memberships',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=50), nullable=False),
        sa.Column('added_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['added_by_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'project_id', name='uq_user_project')
    )
    op.create_index(op.f('ix_project_memberships_id'), 'project_memberships', ['id'], unique=False)
    op.create_index(op.f('ix_project_memberships_user_id'), 'project_memberships', ['user_id'], unique=False)
    op.create_index(op.f('ix_project_memberships_project_id'), 'project_memberships', ['project_id'], unique=False)
    op.create_index(op.f('ix_project_memberships_role'), 'project_memberships', ['role'], unique=False)

    # Cameras table
    op.create_table('cameras',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('location', geoalchemy2.types.Geography(geometry_type='POINT', srid=4326, dimension=2, from_text='ST_GeogFromText', name='geography'), nullable=True),
        sa.Column('installed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('config', sa.JSON(), nullable=True),
        sa.Column('serial_number', sa.String(length=50), nullable=True),
        sa.Column('imei', sa.String(length=50), nullable=True),
        sa.Column('manufacturer', sa.String(length=100), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('hardware_revision', sa.String(length=50), nullable=True),
        sa.Column('box', sa.String(length=100), nullable=True),
        sa.Column('order', sa.String(length=50), nullable=True),
        sa.Column('scanned_date', sa.Date(), nullable=True),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='inventory'),
        sa.Column('battery_percent', sa.Integer(), nullable=True),
        sa.Column('sd_used_mb', sa.Integer(), nullable=True),
        sa.Column('sd_total_mb', sa.Integer(), nullable=True),
        sa.Column('temperature_c', sa.Integer(), nullable=True),
        sa.Column('signal_quality', sa.Integer(), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_daily_report_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_image_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_maintenance_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_cameras_id'), 'cameras', ['id'], unique=False)
    op.create_index(op.f('ix_cameras_serial_number'), 'cameras', ['serial_number'], unique=True)
    op.create_index(op.f('ix_cameras_imei'), 'cameras', ['imei'], unique=True)
    op.create_index(op.f('ix_cameras_manufacturer'), 'cameras', ['manufacturer'], unique=False)
    op.create_index(op.f('ix_cameras_model'), 'cameras', ['model'], unique=False)
    op.create_index(op.f('ix_cameras_project_id'), 'cameras', ['project_id'], unique=False)
    op.create_index(op.f('ix_cameras_status'), 'cameras', ['status'], unique=False)
    op.create_index(op.f('ix_cameras_last_seen'), 'cameras', ['last_seen'], unique=False)

    # Images table
    op.create_table('images',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('uuid', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('storage_path', sa.String(length=512), nullable=False),
        sa.Column('thumbnail_path', sa.String(length=512), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False, server_default='pending'),
        sa.Column('image_metadata', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_images_id'), 'images', ['id'], unique=False)
    op.create_index(op.f('ix_images_uuid'), 'images', ['uuid'], unique=True)
    op.create_index(op.f('ix_images_camera_id'), 'images', ['camera_id'], unique=False)
    op.create_index(op.f('ix_images_uploaded_at'), 'images', ['uploaded_at'], unique=False)
    op.create_index(op.f('ix_images_status'), 'images', ['status'], unique=False)

    # Detections table
    op.create_table('detections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('image_id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=True),
        sa.Column('bbox', sa.JSON(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['image_id'], ['images.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_detections_id'), 'detections', ['id'], unique=False)
    op.create_index(op.f('ix_detections_image_id'), 'detections', ['image_id'], unique=False)
    op.create_index(op.f('ix_detections_category'), 'detections', ['category'], unique=False)

    # Classifications table
    op.create_table('classifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('detection_id', sa.Integer(), nullable=False),
        sa.Column('species', sa.String(length=255), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.ForeignKeyConstraint(['detection_id'], ['detections.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_classifications_id'), 'classifications', ['id'], unique=False)
    op.create_index(op.f('ix_classifications_detection_id'), 'classifications', ['detection_id'], unique=False)
    op.create_index(op.f('ix_classifications_species'), 'classifications', ['species'], unique=False)

    # Alert rules table
    op.create_table('alert_rules',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('rule_type', sa.String(length=50), nullable=False),
        sa.Column('condition', sa.JSON(), nullable=False),
        sa.Column('notification_method', sa.String(length=50), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alert_rules_id'), 'alert_rules', ['id'], unique=False)

    # Alert logs table
    op.create_table('alert_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('rule_id', sa.Integer(), nullable=False),
        sa.Column('triggered_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('details', sa.JSON(), nullable=True),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.ForeignKeyConstraint(['rule_id'], ['alert_rules.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alert_logs_id'), 'alert_logs', ['id'], unique=False)

    # Project notification preferences table
    op.create_table('project_notification_preferences',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('telegram_chat_id', sa.String(length=50), nullable=True),
        sa.Column('notify_species', sa.JSON(), nullable=True),
        sa.Column('notify_low_battery', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('battery_threshold', sa.Integer(), nullable=False, server_default='30'),
        sa.Column('notify_system_health', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('notification_channels', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'project_id', name='uq_user_project_notification')
    )
    op.create_index(op.f('ix_project_notification_preferences_id'), 'project_notification_preferences', ['id'], unique=False)
    op.create_index(op.f('ix_project_notification_preferences_user_id'), 'project_notification_preferences', ['user_id'], unique=False)
    op.create_index(op.f('ix_project_notification_preferences_project_id'), 'project_notification_preferences', ['project_id'], unique=False)

    # Notification logs table
    op.create_table('notification_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('notification_type', sa.String(length=50), nullable=False),
        sa.Column('channel', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('trigger_data', sa.JSON(), nullable=False),
        sa.Column('message_content', sa.Text(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_notification_logs_id'), 'notification_logs', ['id'], unique=False)
    op.create_index(op.f('ix_notification_logs_user_id'), 'notification_logs', ['user_id'], unique=False)
    op.create_index(op.f('ix_notification_logs_notification_type'), 'notification_logs', ['notification_type'], unique=False)
    op.create_index(op.f('ix_notification_logs_channel'), 'notification_logs', ['channel'], unique=False)
    op.create_index(op.f('ix_notification_logs_status'), 'notification_logs', ['status'], unique=False)
    op.create_index(op.f('ix_notification_logs_created_at'), 'notification_logs', ['created_at'], unique=False)

    # Telegram config table
    op.create_table('telegram_config',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('bot_token', sa.String(length=100), nullable=True),
        sa.Column('bot_username', sa.String(length=100), nullable=True),
        sa.Column('is_configured', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('health_status', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Telegram linking tokens table
    op.create_table('telegram_linking_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_telegram_linking_tokens_id'), 'telegram_linking_tokens', ['id'], unique=False)
    op.create_index(op.f('ix_telegram_linking_tokens_token'), 'telegram_linking_tokens', ['token'], unique=True)
    op.create_index(op.f('ix_telegram_linking_tokens_expires_at'), 'telegram_linking_tokens', ['expires_at'], unique=False)


def downgrade() -> None:
    # Drop all tables in reverse order
    op.drop_table('telegram_linking_tokens')
    op.drop_table('telegram_config')
    op.drop_table('notification_logs')
    op.drop_table('project_notification_preferences')
    op.drop_table('alert_logs')
    op.drop_table('alert_rules')
    op.drop_table('classifications')
    op.drop_table('detections')
    op.drop_table('images')
    op.drop_table('cameras')
    op.drop_table('project_memberships')
    op.drop_table('projects')
    op.drop_table('email_allowlist')
    op.drop_table('users')
