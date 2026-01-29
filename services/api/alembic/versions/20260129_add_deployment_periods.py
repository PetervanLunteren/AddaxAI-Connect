"""Add camera_deployment_periods table

Revision ID: 20260129_add_deployment_periods
Revises: 20250127_add_detection_threshold
Create Date: 2026-01-29

"""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geography


# revision identifiers, used by Alembic
revision = '20260129_add_deployment_periods'
down_revision = '20250127_add_detection_threshold'
branch_labels = None
depends_on = None


def upgrade():
    """Create camera_deployment_periods table"""
    op.create_table(
        'camera_deployment_periods',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('deployment_id', sa.Integer(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('location', Geography(geometry_type='POINT', srid=4326, spatial_index=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('camera_id', 'deployment_id', name='uq_camera_deployment')
    )

    # Create indexes for efficient queries
    op.create_index('idx_deployment_camera', 'camera_deployment_periods', ['camera_id'])
    op.create_index('idx_deployment_dates', 'camera_deployment_periods', ['start_date', 'end_date'])
    # PostGIS spatial index created automatically via spatial_index=True in Geography column


def downgrade():
    """Drop camera_deployment_periods table"""
    op.drop_index('idx_deployment_dates', table_name='camera_deployment_periods')
    op.drop_index('idx_deployment_camera', table_name='camera_deployment_periods')
    op.drop_table('camera_deployment_periods')
