"""Add like fields to images

Adds a project-wide "liked" flag so users can curate a best-of gallery
for reporting and communication. Mirrors the existing verification fields
(boolean + timestamp + user_id) and is shared across the project rather
than per-user.

Revision ID: 20260413_add_image_like
Revises: 20260410_add_behavior
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa


revision = '20260413_add_image_like'
down_revision = '20260410_add_behavior'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('images', sa.Column(
        'is_liked', sa.Boolean(), nullable=False, server_default='false'
    ))
    op.add_column('images', sa.Column(
        'liked_at', sa.DateTime(timezone=True), nullable=True
    ))
    op.add_column('images', sa.Column(
        'liked_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True
    ))
    op.create_index('ix_images_is_liked', 'images', ['is_liked'])


def downgrade():
    op.drop_index('ix_images_is_liked', table_name='images')
    op.drop_column('images', 'liked_by_user_id')
    op.drop_column('images', 'liked_at')
    op.drop_column('images', 'is_liked')
