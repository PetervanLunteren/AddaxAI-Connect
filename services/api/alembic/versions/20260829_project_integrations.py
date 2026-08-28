"""Add project_integrations, one row per project and outbound integration.

EarthRanger via Gundi is the first kind. The table is generic on purpose:
the next integrations (each with its own page) get a row kind here instead
of a table each.

Revision ID: 20260829_project_integrations
Revises: 20260828_drop_feed_seen
Create Date: 2026-08-29

"""
from alembic import op
import sqlalchemy as sa


revision = '20260829_project_integrations'
down_revision = '20260828_drop_feed_seen'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'project_integrations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=50), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('is_enabled', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('health_status', sa.String(length=50), nullable=True),
        sa.Column('last_health_check', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('events_sent', sa.Integer(), server_default='0', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'kind', name='uq_project_integrations_project_kind'),
    )
    op.create_index('ix_project_integrations_id', 'project_integrations', ['id'])
    op.create_index('ix_project_integrations_project_id', 'project_integrations', ['project_id'])


def downgrade():
    op.drop_index('ix_project_integrations_project_id', table_name='project_integrations')
    op.drop_index('ix_project_integrations_id', table_name='project_integrations')
    op.drop_table('project_integrations')
