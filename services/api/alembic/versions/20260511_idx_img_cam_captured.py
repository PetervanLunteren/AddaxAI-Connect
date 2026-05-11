"""Add partial composite index on images(camera_id, captured_at).

The Deployment-timeline rewrite asks Postgres for per-camera per-day
image aggregates filtered by `is_hidden = false`. The existing
single-column indexes on `camera_id` and `captured_at` force a bitmap
heap scan when both columns are filtered. A small partial composite
index on the visible-images subset keeps the timeline page snappy on
projects with millions of rows.

Revision ID: 20260511_idx_img_cam_captured
Revises: 20260508_add_pw_changed_at
Create Date: 2026-05-11

"""
from alembic import op


revision = '20260511_idx_img_cam_captured'
down_revision = '20260508_add_pw_changed_at'
branch_labels = None
depends_on = None


INDEX_NAME = 'ix_images_camera_id_captured_at_visible'


def upgrade():
    op.create_index(
        INDEX_NAME,
        'images',
        ['camera_id', 'captured_at'],
        postgresql_where='is_hidden = false',
        if_not_exists=True,
    )


def downgrade():
    op.drop_index(INDEX_NAME, table_name='images', if_exists=True)
