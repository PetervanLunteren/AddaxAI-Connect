"""Add process_started_at to bulk_upload_jobs.

`started_at` is set during inspect and `finished_at` after
classification, so the elapsed covers inspect + user-paced
awaiting_confirmation + process. Useless for measuring real per-
image processing throughput. Add a dedicated timestamp the worker
sets when the process phase begins, so the frontend can derive a
self-calibrating ETA rate from recent completed jobs.

Revision ID: 20260517_bulk_process_started
Revises: 20260516_widen_bulk_status
Create Date: 2026-05-17

"""
from alembic import op
import sqlalchemy as sa


revision = '20260517_bulk_process_started'
down_revision = '20260516_widen_bulk_status'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'bulk_upload_jobs',
        sa.Column('process_started_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('bulk_upload_jobs', 'process_started_at')
