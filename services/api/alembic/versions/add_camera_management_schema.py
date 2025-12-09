"""Add camera management schema for field operations

Revision ID: add_camera_mgmt
Revises: 77a6213767be
Create Date: 2025-12-09 12:00:00.000000

This migration adds complete camera management functionality including:
- Projects table (multi-tenancy via project_id)
- Camera extensions (health metrics, identifiers, timestamps)
- SIM inventory and assignment tracking
- Settings profiles and firmware releases (offline)
- Placement planning (planned vs actual)
- Maintenance task management
- Unknown device queue
"""
from alembic import op
import sqlalchemy as sa
import geoalchemy2

# revision identifiers, used by Alembic.
revision = 'add_camera_mgmt'
down_revision = '77a6213767be'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Apply camera management schema additions"""

    # ========================================
    # 1. Create projects table (tenant isolation)
    # ========================================
    op.create_table(
        'projects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),

        # Default settings for cameras in this project
        sa.Column('default_settings_profile_id', sa.Integer(), nullable=True),
        sa.Column('default_firmware_id', sa.Integer(), nullable=True),
        sa.Column('default_placement_fov', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('default_placement_range', sa.Integer(), nullable=False, server_default='20'),

        # Maintenance thresholds
        sa.Column('battery_low_threshold', sa.Integer(), nullable=False, server_default='20'),
        sa.Column('sd_high_threshold', sa.Integer(), nullable=False, server_default='80'),
        sa.Column('silence_threshold_hours', sa.Integer(), nullable=False, server_default='48'),

        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True),

        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_projects_id', 'projects', ['id'])
    op.create_index('ix_projects_name', 'projects', ['name'])
    op.create_index('ix_projects_is_active', 'projects', ['is_active'])


    # ========================================
    # 2. Extend cameras table with camera management fields
    # ========================================

    # Add identifiers
    op.add_column('cameras', sa.Column('serial_number', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('imei', sa.String(50), nullable=True))
    op.add_column('cameras', sa.Column('manufacturer', sa.String(100), nullable=True))
    op.add_column('cameras', sa.Column('model', sa.String(100), nullable=True))
    op.add_column('cameras', sa.Column('hardware_revision', sa.String(50), nullable=True))

    # Add project assignment
    op.add_column('cameras', sa.Column('project_id', sa.Integer(), nullable=True))
    op.add_column('cameras', sa.Column('status', sa.String(50), nullable=False, server_default='inventory'))

    # Add health metrics (from daily reports)
    op.add_column('cameras', sa.Column('battery_percent', sa.Integer(), nullable=True))
    op.add_column('cameras', sa.Column('sd_used_mb', sa.Integer(), nullable=True))
    op.add_column('cameras', sa.Column('sd_total_mb', sa.Integer(), nullable=True))
    op.add_column('cameras', sa.Column('temperature_c', sa.Integer(), nullable=True))
    op.add_column('cameras', sa.Column('signal_quality', sa.Integer(), nullable=True))

    # Add timestamps
    op.add_column('cameras', sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cameras', sa.Column('last_daily_report_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cameras', sa.Column('last_image_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('cameras', sa.Column('last_maintenance_at', sa.DateTime(timezone=True), nullable=True))

    # Add metadata fields
    op.add_column('cameras', sa.Column('tags', sa.JSON(), nullable=True))
    op.add_column('cameras', sa.Column('notes', sa.Text(), nullable=True))
    op.add_column('cameras', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.add_column('cameras', sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True))

    # Create indexes on cameras
    op.create_index('ix_cameras_serial_number', 'cameras', ['serial_number'], unique=True)
    op.create_index('ix_cameras_imei', 'cameras', ['imei'], unique=True)
    op.create_index('ix_cameras_project_id', 'cameras', ['project_id'])
    op.create_index('ix_cameras_status', 'cameras', ['status'])
    op.create_index('ix_cameras_last_seen', 'cameras', ['last_seen'])
    op.create_index('ix_cameras_manufacturer', 'cameras', ['manufacturer'])
    op.create_index('ix_cameras_model', 'cameras', ['model'])

    # Create foreign key to projects
    op.create_foreign_key('fk_cameras_project_id', 'cameras', 'projects', ['project_id'], ['id'])


    # ========================================
    # 3. Add project_id to existing tables
    # ========================================

    # Add project_id to users table (user belongs to project)
    op.add_column('users', sa.Column('project_id', sa.Integer(), nullable=True))
    op.create_index('ix_users_project_id', 'users', ['project_id'])
    op.create_foreign_key('fk_users_project_id', 'users', 'projects', ['project_id'], ['id'])

    # Add project_id to images table (for filtering)
    op.add_column('images', sa.Column('project_id', sa.Integer(), nullable=True))
    op.create_index('ix_images_project_id', 'images', ['project_id'])
    op.create_foreign_key('fk_images_project_id', 'images', 'projects', ['project_id'], ['id'])


    # ========================================
    # 4. Create SIM inventory tables
    # ========================================
    op.create_table(
        'sims',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('iccid', sa.String(50), nullable=False),
        sa.Column('msisdn', sa.String(50), nullable=True),
        sa.Column('provider', sa.String(100), nullable=False),

        sa.Column('status', sa.String(50), nullable=False, server_default='inventory'),
        sa.Column('subscription_type', sa.String(50), nullable=True),
        sa.Column('data_allowance_mb', sa.Integer(), nullable=True),

        sa.Column('subscription_start', sa.Date(), nullable=True),
        sa.Column('subscription_end', sa.Date(), nullable=True),
        sa.Column('auto_renew', sa.Boolean(), nullable=False, server_default='false'),

        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True),

        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_sims_id', 'sims', ['id'])
    op.create_index('ix_sims_iccid', 'sims', ['iccid'], unique=True)
    op.create_index('ix_sims_status', 'sims', ['status'])
    op.create_index('ix_sims_project_id', 'sims', ['project_id'])


    # Camera-SIM assignment history
    op.create_table(
        'camera_sim_assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('sim_id', sa.Integer(), nullable=False),

        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('assigned_by_user_id', sa.Integer(), nullable=True),
        sa.Column('unassigned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('unassigned_by_user_id', sa.Integer(), nullable=True),

        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),

        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id']),
        sa.ForeignKeyConstraint(['sim_id'], ['sims.id']),
        sa.ForeignKeyConstraint(['assigned_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['unassigned_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_camera_sim_assignments_id', 'camera_sim_assignments', ['id'])
    op.create_index('ix_camera_sim_assignments_camera_id', 'camera_sim_assignments', ['camera_id'])
    op.create_index('ix_camera_sim_assignments_sim_id', 'camera_sim_assignments', ['sim_id'])
    op.create_index('ix_camera_sim_assignments_is_active', 'camera_sim_assignments', ['is_active'])


    # ========================================
    # 5. Create settings profiles table (offline)
    # ========================================
    op.create_table(
        'settings_profiles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),

        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='draft'),

        sa.Column('file_path', sa.String(512), nullable=False),
        sa.Column('file_version', sa.String(50), nullable=True),
        sa.Column('compatible_models', sa.JSON(), nullable=True),

        sa.Column('install_instructions', sa.Text(), nullable=True),

        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True),

        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_settings_profiles_id', 'settings_profiles', ['id'])
    op.create_index('ix_settings_profiles_project_id', 'settings_profiles', ['project_id'])
    op.create_index('ix_settings_profiles_status', 'settings_profiles', ['status'])

    # Create foreign keys from projects to settings_profiles (for defaults)
    op.create_foreign_key('fk_projects_default_settings', 'projects', 'settings_profiles',
                          ['default_settings_profile_id'], ['id'])


    # ========================================
    # 6. Create firmware releases table (offline)
    # ========================================
    op.create_table(
        'firmware_releases',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),

        sa.Column('version', sa.String(50), nullable=False),
        sa.Column('release_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(50), nullable=False, server_default='draft'),
        sa.Column('criticality', sa.String(50), nullable=False, server_default='optional'),

        sa.Column('file_path', sa.String(512), nullable=False),
        sa.Column('checksum_sha256', sa.String(64), nullable=False),
        sa.Column('compatible_models', sa.JSON(), nullable=True),

        sa.Column('release_notes', sa.Text(), nullable=True),
        sa.Column('install_instructions', sa.Text(), nullable=True),

        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True),

        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_firmware_releases_id', 'firmware_releases', ['id'])
    op.create_index('ix_firmware_releases_project_id', 'firmware_releases', ['project_id'])
    op.create_index('ix_firmware_releases_version', 'firmware_releases', ['version'])
    op.create_index('ix_firmware_releases_status', 'firmware_releases', ['status'])

    # Create foreign keys from projects to firmware_releases (for defaults)
    op.create_foreign_key('fk_projects_default_firmware', 'projects', 'firmware_releases',
                          ['default_firmware_id'], ['id'])


    # ========================================
    # 7. Create placement plans table
    # ========================================
    op.create_table(
        'placement_plans',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),

        # Planned placement
        sa.Column('planned_location', geoalchemy2.types.Geography(
            geometry_type='POINT', srid=4326, dimension=2,
            from_text='ST_GeogFromText', name='geography'
        ), nullable=False),
        sa.Column('planned_bearing', sa.Integer(), nullable=True),
        sa.Column('planned_range_m', sa.Integer(), nullable=False, server_default='20'),
        sa.Column('planned_fov_degrees', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('plan_status', sa.String(50), nullable=False, server_default='draft'),

        # Actual placement (auto-updated from GPS data)
        sa.Column('actual_location', geoalchemy2.types.Geography(
            geometry_type='POINT', srid=4326, dimension=2,
            from_text='ST_GeogFromText', name='geography'
        ), nullable=True),
        sa.Column('actual_bearing', sa.Integer(), nullable=True),
        sa.Column('last_confirmed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('confirmed_by_user_id', sa.Integer(), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), onupdate=sa.text('now()'), nullable=True),

        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['confirmed_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('camera_id', name='uq_placement_plans_camera_id')
    )
    op.create_index('ix_placement_plans_id', 'placement_plans', ['id'])
    op.create_index('ix_placement_plans_camera_id', 'placement_plans', ['camera_id'], unique=True)
    op.create_index('ix_placement_plans_project_id', 'placement_plans', ['project_id'])
    op.create_index('ix_placement_plans_plan_status', 'placement_plans', ['plan_status'])


    # ========================================
    # 8. Create maintenance tasks table
    # ========================================
    op.create_table(
        'maintenance_tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),

        sa.Column('task_type', sa.String(50), nullable=False),
        sa.Column('priority', sa.String(50), nullable=False, server_default='medium'),
        sa.Column('origin', sa.String(50), nullable=False, server_default='manual'),

        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('due_date', sa.Date(), nullable=True),

        sa.Column('status', sa.String(50), nullable=False, server_default='open'),

        sa.Column('assigned_to_user_id', sa.Integer(), nullable=True),
        sa.Column('resolution_notes', sa.Text(), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=True),
        sa.Column('status_changed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),

        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id']),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.ForeignKeyConstraint(['assigned_to_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_maintenance_tasks_id', 'maintenance_tasks', ['id'])
    op.create_index('ix_maintenance_tasks_camera_id', 'maintenance_tasks', ['camera_id'])
    op.create_index('ix_maintenance_tasks_project_id', 'maintenance_tasks', ['project_id'])
    op.create_index('ix_maintenance_tasks_task_type', 'maintenance_tasks', ['task_type'])
    op.create_index('ix_maintenance_tasks_priority', 'maintenance_tasks', ['priority'])
    op.create_index('ix_maintenance_tasks_status', 'maintenance_tasks', ['status'])
    op.create_index('ix_maintenance_tasks_created_at', 'maintenance_tasks', ['created_at'])


    # ========================================
    # 9. Create unknown devices queue table
    # ========================================
    op.create_table(
        'unknown_devices',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('serial_number', sa.String(50), nullable=False),

        sa.Column('first_contact_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_contact_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('contact_count', sa.Integer(), nullable=False, server_default='1'),

        # Parsed data from first contact
        sa.Column('manufacturer', sa.String(100), nullable=True),
        sa.Column('model', sa.String(100), nullable=True),
        sa.Column('first_gps_location', geoalchemy2.types.Geography(
            geometry_type='POINT', srid=4326, dimension=2,
            from_text='ST_GeogFromText', name='geography'
        ), nullable=True),

        # Admin claiming
        sa.Column('claimed', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('claimed_by_user_id', sa.Integer(), nullable=True),
        sa.Column('claimed_to_camera_id', sa.Integer(), nullable=True),
        sa.Column('claimed_to_project_id', sa.Integer(), nullable=True),

        sa.ForeignKeyConstraint(['claimed_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['claimed_to_camera_id'], ['cameras.id']),
        sa.ForeignKeyConstraint(['claimed_to_project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_unknown_devices_id', 'unknown_devices', ['id'])
    op.create_index('ix_unknown_devices_serial_number', 'unknown_devices', ['serial_number'])
    op.create_index('ix_unknown_devices_claimed', 'unknown_devices', ['claimed'])
    op.create_index('ix_unknown_devices_first_contact_at', 'unknown_devices', ['first_contact_at'])


def downgrade() -> None:
    """Revert camera management schema additions"""

    # Drop tables in reverse order (respect foreign keys)
    op.drop_index('ix_unknown_devices_first_contact_at', table_name='unknown_devices')
    op.drop_index('ix_unknown_devices_claimed', table_name='unknown_devices')
    op.drop_index('ix_unknown_devices_serial_number', table_name='unknown_devices')
    op.drop_index('ix_unknown_devices_id', table_name='unknown_devices')
    op.drop_table('unknown_devices')

    op.drop_index('ix_maintenance_tasks_created_at', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_status', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_priority', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_task_type', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_project_id', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_camera_id', table_name='maintenance_tasks')
    op.drop_index('ix_maintenance_tasks_id', table_name='maintenance_tasks')
    op.drop_table('maintenance_tasks')

    op.drop_index('ix_placement_plans_plan_status', table_name='placement_plans')
    op.drop_index('ix_placement_plans_project_id', table_name='placement_plans')
    op.drop_index('ix_placement_plans_camera_id', table_name='placement_plans')
    op.drop_index('ix_placement_plans_id', table_name='placement_plans')
    op.drop_table('placement_plans')

    # Drop foreign keys from projects first
    op.drop_constraint('fk_projects_default_firmware', 'projects', type_='foreignkey')
    op.drop_constraint('fk_projects_default_settings', 'projects', type_='foreignkey')

    op.drop_index('ix_firmware_releases_status', table_name='firmware_releases')
    op.drop_index('ix_firmware_releases_version', table_name='firmware_releases')
    op.drop_index('ix_firmware_releases_project_id', table_name='firmware_releases')
    op.drop_index('ix_firmware_releases_id', table_name='firmware_releases')
    op.drop_table('firmware_releases')

    op.drop_index('ix_settings_profiles_status', table_name='settings_profiles')
    op.drop_index('ix_settings_profiles_project_id', table_name='settings_profiles')
    op.drop_index('ix_settings_profiles_id', table_name='settings_profiles')
    op.drop_table('settings_profiles')

    op.drop_index('ix_camera_sim_assignments_is_active', table_name='camera_sim_assignments')
    op.drop_index('ix_camera_sim_assignments_sim_id', table_name='camera_sim_assignments')
    op.drop_index('ix_camera_sim_assignments_camera_id', table_name='camera_sim_assignments')
    op.drop_index('ix_camera_sim_assignments_id', table_name='camera_sim_assignments')
    op.drop_table('camera_sim_assignments')

    op.drop_index('ix_sims_project_id', table_name='sims')
    op.drop_index('ix_sims_status', table_name='sims')
    op.drop_index('ix_sims_iccid', table_name='sims')
    op.drop_index('ix_sims_id', table_name='sims')
    op.drop_table('sims')

    # Remove project_id from images
    op.drop_constraint('fk_images_project_id', 'images', type_='foreignkey')
    op.drop_index('ix_images_project_id', table_name='images')
    op.drop_column('images', 'project_id')

    # Remove project_id from users
    op.drop_constraint('fk_users_project_id', 'users', type_='foreignkey')
    op.drop_index('ix_users_project_id', table_name='users')
    op.drop_column('users', 'project_id')

    # Remove camera extensions
    op.drop_constraint('fk_cameras_project_id', 'cameras', type_='foreignkey')
    op.drop_index('ix_cameras_model', table_name='cameras')
    op.drop_index('ix_cameras_manufacturer', table_name='cameras')
    op.drop_index('ix_cameras_last_seen', table_name='cameras')
    op.drop_index('ix_cameras_status', table_name='cameras')
    op.drop_index('ix_cameras_project_id', table_name='cameras')
    op.drop_index('ix_cameras_imei', table_name='cameras')
    op.drop_index('ix_cameras_serial_number', table_name='cameras')

    op.drop_column('cameras', 'updated_at')
    op.drop_column('cameras', 'created_at')
    op.drop_column('cameras', 'notes')
    op.drop_column('cameras', 'tags')
    op.drop_column('cameras', 'last_maintenance_at')
    op.drop_column('cameras', 'last_image_at')
    op.drop_column('cameras', 'last_daily_report_at')
    op.drop_column('cameras', 'last_seen')
    op.drop_column('cameras', 'signal_quality')
    op.drop_column('cameras', 'temperature_c')
    op.drop_column('cameras', 'sd_total_mb')
    op.drop_column('cameras', 'sd_used_mb')
    op.drop_column('cameras', 'battery_percent')
    op.drop_column('cameras', 'status')
    op.drop_column('cameras', 'project_id')
    op.drop_column('cameras', 'hardware_revision')
    op.drop_column('cameras', 'model')
    op.drop_column('cameras', 'manufacturer')
    op.drop_column('cameras', 'imei')
    op.drop_column('cameras', 'serial_number')

    # Drop projects table
    op.drop_index('ix_projects_is_active', table_name='projects')
    op.drop_index('ix_projects_name', table_name='projects')
    op.drop_index('ix_projects_id', table_name='projects')
    op.drop_table('projects')
