"""Drop report_email from project_notification_preferences

The report_email field was never exposed in the UI and all email
notifications should always go to the user's account email.

Revision ID: 20260319_drop_report_email
Revises: 20260316_add_geofencing
Create Date: 2026-03-19

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260319_drop_report_email'
down_revision = '20260316_add_geofencing'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('project_notification_preferences', 'report_email')


def downgrade():
    op.add_column('project_notification_preferences', sa.Column('report_email', sa.String(255), nullable=True))
