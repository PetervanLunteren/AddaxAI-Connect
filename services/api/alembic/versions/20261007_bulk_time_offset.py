"""Add time_offset_seconds to bulk_upload_jobs.

A camera with a wrong clock (reset, AM/PM mix-up, wrong timezone) writes
wrong capture times. The uploader can correct them in the review step;
the worker adds this many seconds to every EXIF capture time of the job.
Zero means no correction, so every existing job keeps its times.

Revision ID: 20261007_bulk_time_offset
Revises: 20260911_species_nullable
Create Date: 2026-10-07

"""
from alembic import op
import sqlalchemy as sa


revision = '20261007_bulk_time_offset'
down_revision = '20260911_species_nullable'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'bulk_upload_jobs',
        sa.Column('time_offset_seconds', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade():
    op.drop_column('bulk_upload_jobs', 'time_offset_seconds')
