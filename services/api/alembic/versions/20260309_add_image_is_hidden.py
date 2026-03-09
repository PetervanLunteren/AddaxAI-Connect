"""Add is_hidden column to images table

Allow project admins to hide images from analysis views
without permanently deleting them.

Revision ID: 20260309_add_image_is_hidden
Revises: 20260309_rename_imei
Create Date: 2026-03-09

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260309_add_image_is_hidden'
down_revision = '20260309_rename_imei'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('images', sa.Column('is_hidden', sa.Boolean(), nullable=False, server_default='false'))
    op.create_index('idx_images_is_hidden', 'images', ['is_hidden'])


def downgrade():
    op.drop_index('idx_images_is_hidden', table_name='images')
    op.drop_column('images', 'is_hidden')
