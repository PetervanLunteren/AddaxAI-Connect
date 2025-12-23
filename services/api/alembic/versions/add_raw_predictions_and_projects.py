"""Add raw_predictions and model_version to classifications, create projects table

Revision ID: add_raw_pred_proj
Revises: add_thumb_rm_crop
Create Date: 2025-12-23 14:30:00.000000

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
    """Add raw_predictions and model_version to classifications, create projects table"""

    # Create projects table
    op.create_table(
        'projects',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', Geography(geometry_type='POLYGON', srid=4326, spatial_index=False), nullable=True),
        sa.Column('excluded_species', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_projects_id'), 'projects', ['id'], unique=False)

    # Add raw_predictions and model_version columns to classifications table
    op.add_column('classifications', sa.Column('raw_predictions', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('classifications', sa.Column('model_version', sa.String(length=100), nullable=True))
    op.create_index(op.f('ix_classifications_model_version'), 'classifications', ['model_version'], unique=False)

    # Add foreign key constraint to users.project_id (was TODO in original schema)
    op.create_foreign_key('fk_users_project_id', 'users', 'projects', ['project_id'], ['id'])

    # Add foreign key constraint to cameras.project_id
    op.create_foreign_key('fk_cameras_project_id', 'cameras', 'projects', ['project_id'], ['id'])


def downgrade() -> None:
    """Remove raw_predictions, model_version, and projects table"""

    # Drop foreign keys
    op.drop_constraint('fk_cameras_project_id', 'cameras', type_='foreignkey')
    op.drop_constraint('fk_users_project_id', 'users', type_='foreignkey')

    # Remove columns from classifications
    op.drop_index(op.f('ix_classifications_model_version'), table_name='classifications')
    op.drop_column('classifications', 'model_version')
    op.drop_column('classifications', 'raw_predictions')

    # Drop projects table
    op.drop_index(op.f('ix_projects_id'), table_name='projects')
    op.drop_table('projects')
