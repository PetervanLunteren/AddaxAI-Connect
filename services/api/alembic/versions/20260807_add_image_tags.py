"""Add tags to images

User-assigned flags for events of interest, such as "infraction" or
"predation event", so specific cases can be retrieved later without
free-text notes or external tracking. Same JSON tags pattern as sites
and cameras, vocabulary emerges through autocomplete.

Revision ID: 20260807_add_image_tags
Revises: 20260807_split_blur_settings
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260807_add_image_tags'
down_revision = '20260807_split_blur_settings'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('images', sa.Column('tags', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('images', 'tags')
