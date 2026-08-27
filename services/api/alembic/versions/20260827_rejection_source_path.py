"""Add rejections.source_path

Where the file sat under the upload root before ingestion moved it to the
rejected/ tree, relative and POSIX. Reprocess puts the file back on that
exact path, so a path-based camera profile (INSTAR reads lat/lon from the
directory name) can identify it again. Before this column the file went
back to the upload root under its flattened name and every path-based
file re-rejected.

Nullable and not backfilled: rows written before this migration keep NULL
and reprocess falls back to the upload root, which is what it did before.
Those rows age out with the 30-day retention.

This also makes the row the only record of a rejection. Ingestion stops
writing the .error.json sidecar, everything it held is on the row.

Revision ID: 20260827_rejection_source_path
Revises: 20260818_security_alert_toggle
Create Date: 2026-08-27

"""
from alembic import op
import sqlalchemy as sa


revision = '20260827_rejection_source_path'
down_revision = '20260818_security_alert_toggle'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'rejections',
        sa.Column('source_path', sa.String(length=512), nullable=True),
    )


def downgrade():
    op.drop_column('rejections', 'source_path')
