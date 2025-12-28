"""Add raw_predictions and model_version to classifications, add location and excluded_species to projects

Revision ID: add_raw_pred_proj
Revises: add_thumb_rm_crop
Create Date: 2025-12-23 14:30:00.000000

Note: projects table was created in add_camera_mgmt migration. This migration only adds columns.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from geoalchemy2 import Geography

# revision identifiers, used by Alembic.
revision = 'add_raw_pred_proj'
down_revision = 'add_thumb_rm_crop'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add raw_predictions and model_version to classifications, add location and excluded_species to projects"""

    # Add location and excluded_species columns to existing projects table
    # (projects table was created in add_camera_mgmt migration)
    op.add_column('projects', sa.Column('location', Geography(geometry_type='POLYGON', srid=4326, spatial_index=False), nullable=True))
    op.add_column('projects', sa.Column('excluded_species', postgresql.JSON(astext_type=sa.Text()), nullable=True))

    # Add raw_predictions and model_version columns to classifications table
    op.add_column('classifications', sa.Column('raw_predictions', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('classifications', sa.Column('model_version', sa.String(length=100), nullable=True))
    op.create_index(op.f('ix_classifications_model_version'), 'classifications', ['model_version'], unique=False)

    # Note: Foreign keys fk_users_project_id and fk_cameras_project_id were already created
    # in add_camera_mgmt migration, so we don't create them again here


def downgrade() -> None:
    """Remove raw_predictions, model_version, and columns from projects table"""

    # Note: We don't drop foreign keys here because they were created in add_camera_mgmt migration

    # Remove columns from classifications
    op.drop_index(op.f('ix_classifications_model_version'), table_name='classifications')
    op.drop_column('classifications', 'model_version')
    op.drop_column('classifications', 'raw_predictions')

    # Remove columns from projects table (don't drop the table itself)
    op.drop_column('projects', 'excluded_species')
    op.drop_column('projects', 'location')
