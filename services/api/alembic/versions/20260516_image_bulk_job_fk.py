"""Link images back to the bulk upload job that created them.

Adds a nullable FK on `images.bulk_upload_job_id`. The bulk-upload
worker now sets it on every image it creates, and the API derives
job progress as the count of those images that have reached
status='classified'. That gives an end-to-end-accurate progress bar
instead of one that hits 100% when the ZIP unpack finishes.

Revision ID: 20260516_image_bulk_job_fk
Revises: 20260516_bulk_upload
Create Date: 2026-05-16

"""
from alembic import op
import sqlalchemy as sa


revision = '20260516_image_bulk_job_fk'
down_revision = '20260516_bulk_upload'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'images',
        sa.Column('bulk_upload_job_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_images_bulk_upload_job_id',
        'images',
        'bulk_upload_jobs',
        ['bulk_upload_job_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_images_bulk_upload_job_id',
        'images',
        ['bulk_upload_job_id'],
        if_not_exists=True,
    )


def downgrade():
    op.drop_index('ix_images_bulk_upload_job_id', table_name='images', if_exists=True)
    op.drop_constraint(
        'fk_images_bulk_upload_job_id',
        'images',
        type_='foreignkey',
    )
    op.drop_column('images', 'bulk_upload_job_id')
