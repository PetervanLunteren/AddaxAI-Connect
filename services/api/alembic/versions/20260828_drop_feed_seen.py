"""Drop feed_seen, the camera updates feed has no personal read state.

The feed keeps one shared state per entry (needs review or reviewed, on
feed_events.resolved_action). The per-user "last opened" watermark only made
the badge disagree between users and is gone.

Revision ID: 20260828_drop_feed_seen
Revises: 20260827_rejection_source_path
Create Date: 2026-08-28

"""
from alembic import op
import sqlalchemy as sa


revision = '20260828_drop_feed_seen'
down_revision = '20260827_rejection_source_path'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('feed_seen')


def downgrade():
    op.create_table(
        'feed_seen',
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id', 'project_id'),
    )
