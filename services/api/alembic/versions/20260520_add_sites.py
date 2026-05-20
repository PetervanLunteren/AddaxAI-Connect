"""Add sites, rename camera_deployment_periods -> deployments, link images to deployments.

Phase 1 of the Site-as-first-class-concept work (see future-plans/site-addition.md).

- New `sites` table: a physical place that groups deployments.
- Rename `camera_deployment_periods` -> `deployments`.
- Rename its `deployment_id` column (the per-camera sequence number 1, 2, 3...)
  to `deployment_number`, freeing the name `deployment_id` to mean a real FK
  on `images`.
- Add `site_id` (FK->sites, nullable) and `name` (free-text label) to deployments.
- Add `deployment_id` (FK->deployments, nullable) to images.

Additive and reversible. No data is backfilled here; scripts/backfill_sites.py
does that as a separate step.

Revision ID: 20260520_add_sites
Revises: 20260518_bulk_jobs_idx
Create Date: 2026-05-20

"""
from alembic import op
import sqlalchemy as sa
from geoalchemy2 import Geography


revision = '20260520_add_sites'
down_revision = '20260518_bulk_jobs_idx'
branch_labels = None
depends_on = None


def upgrade():
    # 1. New sites table
    op.create_table(
        'sites',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('uuid', sa.String(length=36), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('location', Geography(geometry_type='POINT', srid=4326, spatial_index=True), nullable=False),
        sa.Column('habitat_type', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'name', name='uq_site_project_name'),
    )
    op.create_index('ix_sites_uuid', 'sites', ['uuid'], unique=True)
    op.create_index('ix_sites_project_id', 'sites', ['project_id'])
    # PostGIS spatial index on location created automatically via spatial_index=True

    # 2. Rename the deployment table and its sequence column.
    # Postgres carries the existing primary key, unique constraint
    # (uq_camera_deployment) and indexes across both renames automatically.
    op.rename_table('camera_deployment_periods', 'deployments')
    op.alter_column('deployments', 'deployment_id', new_column_name='deployment_number')

    # 3. New columns on deployments
    op.add_column('deployments', sa.Column('site_id', sa.Integer(), nullable=True))
    op.add_column('deployments', sa.Column('name', sa.String(length=100), nullable=True))
    op.create_foreign_key(
        'fk_deployments_site_id', 'deployments', 'sites',
        ['site_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_deployments_site_id', 'deployments', ['site_id'])

    # 4. Link images to deployments
    op.add_column('images', sa.Column('deployment_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_images_deployment_id', 'images', 'deployments',
        ['deployment_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_images_deployment_id', 'images', ['deployment_id'], if_not_exists=True)


def downgrade():
    op.drop_index('ix_images_deployment_id', table_name='images', if_exists=True)
    op.drop_constraint('fk_images_deployment_id', 'images', type_='foreignkey')
    op.drop_column('images', 'deployment_id')

    op.drop_index('ix_deployments_site_id', table_name='deployments')
    op.drop_constraint('fk_deployments_site_id', 'deployments', type_='foreignkey')
    op.drop_column('deployments', 'name')
    op.drop_column('deployments', 'site_id')
    op.alter_column('deployments', 'deployment_number', new_column_name='deployment_id')
    op.rename_table('deployments', 'camera_deployment_periods')

    op.drop_index('ix_sites_project_id', table_name='sites')
    op.drop_index('ix_sites_uuid', table_name='sites')
    op.drop_table('sites')
