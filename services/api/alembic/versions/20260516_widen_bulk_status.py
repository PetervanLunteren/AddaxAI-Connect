"""Widen bulk_upload_jobs.status from varchar(20) to varchar(30).

The original column was sized for short statuses like queued/done.
The review flow added 'awaiting_confirmation' (22 chars) which trips
varchar(20). Bump to 30 with headroom.

Revision ID: 20260516_widen_bulk_status
Revises: 20260516_bulk_upload_manifest
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa


revision = '20260516_widen_bulk_status'
down_revision = '20260516_bulk_upload_manifest'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'bulk_upload_jobs',
        'status',
        existing_type=sa.String(length=20),
        type_=sa.String(length=30),
        existing_nullable=False,
        existing_server_default='queued',
    )


def downgrade():
    op.alter_column(
        'bulk_upload_jobs',
        'status',
        existing_type=sa.String(length=30),
        type_=sa.String(length=20),
        existing_nullable=False,
        existing_server_default='queued',
    )
