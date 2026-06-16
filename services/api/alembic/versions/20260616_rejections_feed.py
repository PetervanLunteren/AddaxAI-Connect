"""Add rejections table and images.ingested_at for the Live feed.

The Live feed shows recent items flowing into a project: successful images by
their pipeline status, and rejected files (e.g. an image sent at setup before
the GPS fix). Rejections become first-class rows so the feed is a single query
instead of a read-time filesystem scan, and so device_id -> project resolution
happens once, at ingestion.

images.ingested_at is the server wall-clock arrival time. images previously had
only captured_at (the camera clock), which is unreliable at setup and not a
sound order. ingested_at is comparable to rejections.rejected_at so the two
sources merge on one sort key. Existing rows get now() at migration time, which
is harmless since they are old and fall off the recent window quickly.

Revision ID: 20260616_rejections_feed
Revises: 20260609_readd_dep_label
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa


revision = '20260616_rejections_feed'
down_revision = '20260609_readd_dep_label'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'rejections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('filename', sa.String(length=255), nullable=False),
        sa.Column('disk_path', sa.String(length=512), nullable=False),
        sa.Column('reason', sa.String(length=50), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('device_id', sa.String(length=50), nullable=True),
        sa.Column('camera_id', sa.Integer(), nullable=True),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('captured_at', sa.DateTime(timezone=False), nullable=True),
        sa.Column('exif_metadata', sa.JSON(), nullable=True),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('rejected_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['camera_id'], ['cameras.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_rejections_id'), 'rejections', ['id'], unique=False)
    op.create_index(op.f('ix_rejections_reason'), 'rejections', ['reason'], unique=False)
    op.create_index(op.f('ix_rejections_device_id'), 'rejections', ['device_id'], unique=False)
    op.create_index(op.f('ix_rejections_camera_id'), 'rejections', ['camera_id'], unique=False)
    op.create_index(op.f('ix_rejections_project_id'), 'rejections', ['project_id'], unique=False)
    op.create_index(op.f('ix_rejections_rejected_at'), 'rejections', ['rejected_at'], unique=False)

    op.add_column(
        'images',
        sa.Column('ingested_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index(op.f('ix_images_ingested_at'), 'images', ['ingested_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_images_ingested_at'), table_name='images')
    op.drop_column('images', 'ingested_at')

    op.drop_index(op.f('ix_rejections_rejected_at'), table_name='rejections')
    op.drop_index(op.f('ix_rejections_project_id'), table_name='rejections')
    op.drop_index(op.f('ix_rejections_camera_id'), table_name='rejections')
    op.drop_index(op.f('ix_rejections_device_id'), table_name='rejections')
    op.drop_index(op.f('ix_rejections_reason'), table_name='rejections')
    op.drop_index(op.f('ix_rejections_id'), table_name='rejections')
    op.drop_table('rejections')
