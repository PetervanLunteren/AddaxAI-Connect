"""Index bulk_upload_jobs on (project_id, created_at).

The list endpoint runs

    SELECT ... FROM bulk_upload_jobs
    WHERE project_id = X
    ORDER BY created_at DESC
    LIMIT 100

once per project poll, plus an orphan-expiry pass that also filters
on status and created_at. A composite index on (project_id,
created_at) lets Postgres satisfy both as a single ordered index
scan instead of filtering then sorting.

Revision ID: 20260518_bulk_jobs_idx
Revises: 20260517_bulk_process_started
Create Date: 2026-05-18

"""
from alembic import op


revision = '20260518_bulk_jobs_idx'
down_revision = '20260517_bulk_process_started'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_bulk_upload_jobs_project_created',
        'bulk_upload_jobs',
        ['project_id', 'created_at'],
        if_not_exists=True,
    )


def downgrade():
    op.drop_index(
        'ix_bulk_upload_jobs_project_created',
        table_name='bulk_upload_jobs',
        if_exists=True,
    )
