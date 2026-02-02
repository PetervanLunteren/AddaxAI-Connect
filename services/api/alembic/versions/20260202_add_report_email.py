"""Add report_email to project_notification_preferences table

Revision ID: 20260202_add_report_email
Revises: 20260202_camera_health_reports
Create Date: 2026-02-02

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260202_add_report_email'
down_revision = '20260202_camera_health_reports'
branch_labels = None
depends_on = None


def upgrade():
    """Add report_email column to project_notification_preferences table"""
    op.add_column(
        'project_notification_preferences',
        sa.Column('report_email', sa.String(255), nullable=True)
    )


def downgrade():
    """Remove report_email column from project_notification_preferences table"""
    op.drop_column('project_notification_preferences', 'report_email')
