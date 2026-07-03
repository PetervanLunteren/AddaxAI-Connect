"""Add feed_events.original_site_name.

The entry's context line said "automatically named X" with X read live from
sites.name, so renaming the site rewrote history ("automatically named
Morning glory"). The name as it was when the event happened is a historical
fact, so it is stored on the event; the current name still comes from the
live join and feeds the resolution line ("<user> renamed this site to Y").
Nullable, old rows fall back to the live name.

Revision ID: 20260703_feed_original_name
Revises: 20260703_feed_site_created
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa


revision = '20260703_feed_original_name'
down_revision = '20260703_feed_site_created'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'feed_events',
        sa.Column('original_site_name', sa.String(length=255), nullable=True),
    )


def downgrade():
    op.drop_column('feed_events', 'original_site_name')
