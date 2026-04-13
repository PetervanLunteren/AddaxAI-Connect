"""Add reference image fields to cameras

Adds a single reference image per camera so field workers can attach a
phone photo of the install site (the tree, the mounting post, a
landmark) for later navigation. Mirrors the project image pattern:
one original plus a 512px thumbnail, both stored by filename in the
local reference-images volume.

Revision ID: 20260414_add_camera_reference_image
Revises: 20260413_add_image_needs_review
Create Date: 2026-04-14

"""
from alembic import op
import sqlalchemy as sa


revision = '20260414_add_camera_reference_image'
down_revision = '20260413_add_image_needs_review'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('cameras', sa.Column('reference_image_path', sa.String(512), nullable=True))
    op.add_column('cameras', sa.Column('reference_thumbnail_path', sa.String(512), nullable=True))


def downgrade():
    op.drop_column('cameras', 'reference_thumbnail_path')
    op.drop_column('cameras', 'reference_image_path')
