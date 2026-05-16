"""Add manifest column to bulk_upload_jobs for the inspect-then-confirm flow.

Slice 1 of the bulk-upload review flow: the worker inspects each ZIP
entry without touching MinIO/DB, writes a JSON manifest with per-status
counts, date range, and the auto-suggested camera. The user reviews
the manifest in the modal and clicks Process to actually commit.

Revision ID: 20260516_bulk_upload_manifest
Revises: 20260516_image_bulk_job_fk
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa


revision = '20260516_bulk_upload_manifest'
down_revision = '20260516_image_bulk_job_fk'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'bulk_upload_jobs',
        sa.Column('manifest', sa.JSON(), nullable=True),
    )
    # camera_id is now unknown until the user confirms in the modal,
    # so drop the NOT NULL. The confirm endpoint sets it before the
    # job moves to processing.
    op.alter_column(
        'bulk_upload_jobs',
        'camera_id',
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade():
    op.alter_column(
        'bulk_upload_jobs',
        'camera_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.drop_column('bulk_upload_jobs', 'manifest')
