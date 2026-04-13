"""Add needs_review fields to images

Adds a project-wide "needs review" flag so members can ask a colleague
for a second pair of eyes on a specific image (low-confidence species
ID, unusual behavior, training scenarios, etc.). Mirrors the like
fields and is shared across the project rather than per-user.

Revision ID: 20260413_add_image_needs_review
Revises: 20260413_add_image_like
Create Date: 2026-04-13

"""
from alembic import op
import sqlalchemy as sa


revision = '20260413_add_image_needs_review'
down_revision = '20260413_add_image_like'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('images', sa.Column(
        'needs_review', sa.Boolean(), nullable=False, server_default='false'
    ))
    op.add_column('images', sa.Column(
        'needs_review_at', sa.DateTime(timezone=True), nullable=True
    ))
    op.add_column('images', sa.Column(
        'needs_review_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True
    ))
    op.create_index('ix_images_needs_review', 'images', ['needs_review'])


def downgrade():
    op.drop_index('ix_images_needs_review', table_name='images')
    op.drop_column('images', 'needs_review_by_user_id')
    op.drop_column('images', 'needs_review_at')
    op.drop_column('images', 'needs_review')
