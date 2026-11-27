"""Who checked a deployment, and the camera updates feed goes.

Step 3b of DEPLOYMENTS_PLAN.md. The camera updates panel is replaced by the
"To check" list on the Deployments page. A deployment the GPS made is to
check until a person looks at it; checked_at and checked_by_user_id record
that on the deployment itself, so the feed table is no longer needed.

Existing deployments count as checked, with the who and when of their feed
entry where there is one. A deployment whose feed entry is still open stays
to check, so nothing waiting for review is lost. Then feed_events is
dropped. Its other columns (distances, frozen names) are not carried over:
the Deployments page works them out from the deployments.

Revision ID: 20261121_deployment_checked
Revises: 20261120_deployment_last_photo
Create Date: 2026-11-21

"""
from alembic import op
import sqlalchemy as sa


revision = '20261121_deployment_checked'
down_revision = '20261120_deployment_last_photo'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployments', sa.Column('checked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('deployments', sa.Column(
        'checked_by_user_id', sa.Integer(),
        sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True,
    ))
    op.execute("""
        UPDATE deployments d
        SET checked_at = COALESCE(f.resolved_at, now()),
            checked_by_user_id = f.resolved_by_user_id
        FROM deployments d2
        LEFT JOIN LATERAL (
            SELECT resolved_at, resolved_by_user_id FROM feed_events
            WHERE deployment_id = d2.id ORDER BY id DESC LIMIT 1
        ) f ON true
        WHERE d.id = d2.id
          AND NOT EXISTS (
              SELECT 1 FROM feed_events o
              WHERE o.deployment_id = d.id AND o.resolved_action IS NULL
          )
    """)
    op.drop_table('feed_events')


def downgrade() -> None:
    # The feed comes back empty: its entries are gone.
    op.create_table(
        'feed_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('camera_id', sa.Integer(), sa.ForeignKey('cameras.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_type', sa.String(30), nullable=False),
        sa.Column('deployment_id', sa.Integer(), sa.ForeignKey('deployments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('site_id', sa.Integer(), sa.ForeignKey('sites.id', ondelete='SET NULL'), nullable=True),
        sa.Column('from_site_id', sa.Integer(), sa.ForeignKey('sites.id', ondelete='SET NULL'), nullable=True),
        sa.Column('distance_m', sa.Float(), nullable=True),
        sa.Column('site_created', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('original_site_name', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('resolved_action', sa.String(20), nullable=True),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolved_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_feed_events_id', 'feed_events', ['id'])
    op.create_index('ix_feed_events_project_id', 'feed_events', ['project_id'])
    op.create_index('ix_feed_events_camera_id', 'feed_events', ['camera_id'])
    op.create_index('ix_feed_events_created_at', 'feed_events', ['created_at'])
    op.drop_column('deployments', 'checked_by_user_id')
    op.drop_column('deployments', 'checked_at')
