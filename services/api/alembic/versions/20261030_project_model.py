"""Classification model per project.

Each project picks its model at creation (shared.classification_models), so
the server-wide CLASSIFICATION_MODEL setting goes. Existing projects are
backfilled from their data, not from the setting: a project with taxonomy
mapping rows ran SpeciesNet (only SpeciesNet servers accept a label CSV),
every other project ran DeepFaune v1.4.

The species_taxonomy table goes too. It held DeepFaune's scientific names,
which now come from the model's vendored taxonomy.csv like every other
fixed-class model's.

Revision ID: 20261030_project_model
Revises: 20261014_project_taxonomy
Create Date: 2026-10-30

"""
from alembic import op
import sqlalchemy as sa


revision = '20261030_project_model'
down_revision = '20261014_project_taxonomy'
branch_labels = None
depends_on = None

SPECIESNET_ID = 'SPECIESNET-v4-0-1-A-v1'
DEEPFAUNE_ID = 'EUR-DF-v1-4'


def upgrade() -> None:
    op.add_column('projects', sa.Column('classification_model', sa.String(50), nullable=True))
    op.execute(
        f"UPDATE projects SET classification_model = '{SPECIESNET_ID}' "
        "WHERE id IN (SELECT DISTINCT project_id FROM taxonomy_mapping)"
    )
    op.execute(
        f"UPDATE projects SET classification_model = '{DEEPFAUNE_ID}' "
        "WHERE classification_model IS NULL"
    )
    op.alter_column('projects', 'classification_model', nullable=False)

    op.drop_index('idx_species_taxonomy_common_name', table_name='species_taxonomy')
    op.drop_table('species_taxonomy')


def downgrade() -> None:
    op.create_table(
        'species_taxonomy',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('common_name', sa.String(255), nullable=False),
        sa.Column('scientific_name', sa.String(255), nullable=True),
        sa.Column('taxon_rank', sa.String(50), nullable=False, server_default='species'),
        sa.Column('model_source', sa.String(100), nullable=False, server_default='deepfaune'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('common_name', name='uq_species_common_name'),
    )
    op.create_index('idx_species_taxonomy_common_name', 'species_taxonomy', ['common_name'])
    # The DeepFaune rows are not restored; 20260206_add_species_taxonomy
    # holds them if ever needed.
    op.drop_column('projects', 'classification_model')
