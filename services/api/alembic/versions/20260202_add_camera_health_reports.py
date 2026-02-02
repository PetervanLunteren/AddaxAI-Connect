"""Add camera_health_reports table for historical health tracking

Revision ID: 20260202_camera_health_reports
Revises: 20260129_add_deployment_periods
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260202_camera_health_reports'
down_revision = '20260129_add_deployment_periods'
branch_labels = None
depends_on = None


def upgrade():
    """Create camera_health_reports table"""
    op.create_table(
        'camera_health_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('report_date', sa.Date(), nullable=False),
        sa.Column('battery_percent', sa.Integer(), nullable=True),
        sa.Column('signal_quality', sa.Integer(), nullable=True),
        sa.Column('temperature_c', sa.Integer(), nullable=True),
        sa.Column('sd_utilization_percent', sa.Float(), nullable=True),
        sa.Column('total_images', sa.Integer(), nullable=True),
        sa.Column('sent_images', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('camera_id', 'report_date', name='uq_camera_report_date')
    )

    # Create indexes for efficient queries
    op.create_index('idx_health_report_camera', 'camera_health_reports', ['camera_id'])
    op.create_index('idx_health_report_date', 'camera_health_reports', ['report_date'])
    op.create_index('idx_health_report_camera_date', 'camera_health_reports', ['camera_id', 'report_date'])


def downgrade():
    """Drop camera_health_reports table"""
    op.drop_index('idx_health_report_camera_date', table_name='camera_health_reports')
    op.drop_index('idx_health_report_date', table_name='camera_health_reports')
    op.drop_index('idx_health_report_camera', table_name='camera_health_reports')
    op.drop_table('camera_health_reports')
