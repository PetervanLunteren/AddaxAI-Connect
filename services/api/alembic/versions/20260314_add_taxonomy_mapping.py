"""Add taxonomy_mapping table for SpeciesNet walk-up algorithm

Stores latin-to-common-name mappings uploaded via CSV.
Used by the classification worker to map raw predictions to
human-readable species labels.

Revision ID: 20260314_add_taxonomy_mapping
Revises: 20260312_add_raw_prediction
Create Date: 2026-03-14

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260314_add_taxonomy_mapping'
down_revision = '20260312_add_raw_prediction'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'taxonomy_mapping',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('latin', sa.String(255), nullable=False),
        sa.Column('common', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_taxonomy_mapping_id', 'taxonomy_mapping', ['id'])
    op.create_index('ix_taxonomy_mapping_latin', 'taxonomy_mapping', ['latin'], unique=True)


def downgrade():
    op.drop_index('ix_taxonomy_mapping_latin', table_name='taxonomy_mapping')
    op.drop_index('ix_taxonomy_mapping_id', table_name='taxonomy_mapping')
    op.drop_table('taxonomy_mapping')
