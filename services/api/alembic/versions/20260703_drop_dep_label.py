"""Drop deployments.name (the position label) again.

The label existed to tell apart several cameras sharing one site, where the
device_id (an IMEI) is not readable. Under the camera updates feed model,
co-located cameras that need telling apart get their own sites instead (the
"new site" feed action), so the site name does the label's job and the extra
concept goes away. Reverses 20260609_readd_dep_label; labels already set are
lost, which is acceptable because the sites they described can carry the text
as their name.

Revision ID: 20260703_drop_dep_label
Revises: 20260703_camera_updates_feed
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa


revision = '20260703_drop_dep_label'
down_revision = '20260703_camera_updates_feed'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_column('deployments', 'name')


def downgrade():
    op.add_column('deployments', sa.Column('name', sa.String(length=100), nullable=True))
