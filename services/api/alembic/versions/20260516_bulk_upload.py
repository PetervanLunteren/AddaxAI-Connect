"""Bulk upload feature: Image.origin, Image.content_hash, BulkUploadJob.

Adds the schema needed to track per-image origin (live FTPS vs bulk
upload), the content hash used to deduplicate re-imports of the same
SD card, and the new BulkUploadJob table that records each ZIP upload
plus its progress.

Revision ID: 20260516_bulk_upload
Revises: 20260511_idx_img_cam_captured
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa


revision = '20260516_bulk_upload'
down_revision = '20260511_idx_img_cam_captured'
branch_labels = None
depends_on = None


def upgrade():
    # Image.origin: 'live' (FTPS) or 'bulk' (SD card upload).
    # Server default backfills every existing row to 'live'.
    op.add_column(
        'images',
        sa.Column(
            'origin',
            sa.String(length=20),
            nullable=False,
            server_default='live',
        ),
    )
    op.create_index(
        'ix_images_origin',
        'images',
        ['origin'],
        if_not_exists=True,
    )

    # Image.content_hash: SHA-256 hex digest. Nullable because live
    # images don't need it; only bulk uploads use it for dedupe.
    op.add_column(
        'images',
        sa.Column('content_hash', sa.String(length=64), nullable=True),
    )
    op.create_index(
        'ix_images_content_hash',
        'images',
        ['content_hash'],
        if_not_exists=True,
    )

    # BulkUploadJob: tracks one ZIP upload from request to completion.
    op.create_table(
        'bulk_upload_jobs',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('uuid', sa.String(length=36), nullable=False, unique=True, index=True),
        sa.Column(
            'project_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id'),
            nullable=False,
        ),
        sa.Column(
            'camera_id',
            sa.Integer(),
            sa.ForeignKey('cameras.id'),
            nullable=False,
            index=True,
        ),
        sa.Column('original_filename', sa.String(length=255), nullable=False),
        sa.Column('staged_object_key', sa.String(length=512), nullable=False),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default='queued',
            index=True,
        ),
        sa.Column('total_files', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('processed_files', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('skipped_files', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            onupdate=sa.func.now(),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_table('bulk_upload_jobs')
    op.drop_index('ix_images_content_hash', table_name='images', if_exists=True)
    op.drop_column('images', 'content_hash')
    op.drop_index('ix_images_origin', table_name='images', if_exists=True)
    op.drop_column('images', 'origin')
