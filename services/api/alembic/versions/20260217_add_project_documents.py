"""Add project_documents table

Per-project file storage for permits, field notes, config files, etc.
Admins upload/delete, all members can view and download.

Revision ID: 20260217_add_project_docs
Revises: 20260214_add_indep_interval
Create Date: 2026-02-17

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260217_add_project_docs'
down_revision = '20260214_add_indep_interval'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'project_documents',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('original_filename', sa.String(255), nullable=False),
        sa.Column('storage_path', sa.String(512), nullable=False),
        sa.Column('file_size', sa.Integer(), nullable=False),
        sa.Column('content_type', sa.String(100), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('uploaded_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table('project_documents')
