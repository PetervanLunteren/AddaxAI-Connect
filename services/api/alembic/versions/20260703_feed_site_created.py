"""Add feed_events.site_created.

Whether the event's site was auto-created for this deployment or an existing
site was reused. Drives the entry copy ("a new site was made and named X" vs
"it was placed at existing site Y") and the actions: the "new site" button
only makes sense when the camera landed on a site that already existed;
on a freshly created site it would be the same as renaming it.

Revision ID: 20260703_feed_site_created
Revises: 20260703_drop_dep_label
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa


revision = '20260703_feed_site_created'
down_revision = '20260703_drop_dep_label'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'feed_events',
        sa.Column('site_created', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('feed_events', 'site_created')
