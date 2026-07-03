"""Add feed_events and feed_seen for the camera updates feed.

The feed is the user-facing replacement for deployment management. Ingestion
keeps deciding sites and deployments on its own; every decision that creates a
deployment (a camera's first image, or a confirmed relocation) now also writes
one feed_events row, so users can see what happened and correct it with one
action (rename the site, pick another site, split off a new site, or undo the
move). Entries never block ingestion and ignoring them is harmless.

feed_seen stores when a user last opened a project's feed and drives the
unseen badge. It is its own table rather than a project_memberships column
because server admins access projects without a membership row.

Revision ID: 20260703_camera_updates_feed
Revises: 20260703_dep_running_mean_pin
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa


revision = '20260703_camera_updates_feed'
down_revision = '20260703_dep_running_mean_pin'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'feed_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('camera_id', sa.Integer(), nullable=False),
        sa.Column('event_type', sa.String(length=30), nullable=False),
        sa.Column('deployment_id', sa.Integer(), nullable=True),
        sa.Column('site_id', sa.Integer(), nullable=True),
        sa.Column('from_site_id', sa.Integer(), nullable=True),
        sa.Column('distance_m', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('resolved_action', sa.String(length=20), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by_user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['deployment_id'], ['deployments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['from_site_id'], ['sites.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['resolved_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_feed_events_id'), 'feed_events', ['id'], unique=False)
    op.create_index(op.f('ix_feed_events_project_id'), 'feed_events', ['project_id'], unique=False)
    op.create_index(op.f('ix_feed_events_camera_id'), 'feed_events', ['camera_id'], unique=False)
    op.create_index(op.f('ix_feed_events_created_at'), 'feed_events', ['created_at'], unique=False)

    op.create_table(
        'feed_seen',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'project_id'),
    )


def downgrade():
    op.drop_table('feed_seen')
    op.drop_index(op.f('ix_feed_events_created_at'), table_name='feed_events')
    op.drop_index(op.f('ix_feed_events_camera_id'), table_name='feed_events')
    op.drop_index(op.f('ix_feed_events_project_id'), table_name='feed_events')
    op.drop_index(op.f('ix_feed_events_id'), table_name='feed_events')
    op.drop_table('feed_events')
