"""Taxonomy mapping per project.

Each SpeciesNet project gets its own label list, so taxonomy_mapping rows
belong to a project and a latin name is unique within it. The existing rows
were server-wide, so every project gets its own copy of them before they go.
The unique constraint leads with project_id, so it also serves the
per-project lookups and no separate index is needed.

Revision ID: 20261014_project_taxonomy
Revises: 20261014_project_country
Create Date: 2026-10-14

"""
from alembic import op
import sqlalchemy as sa


revision = '20261014_project_taxonomy'
down_revision = '20261014_project_country'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index('ix_taxonomy_mapping_latin', table_name='taxonomy_mapping')
    op.add_column(
        'taxonomy_mapping',
        sa.Column(
            'project_id', sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=True,
        ),
    )
    op.execute("""
        INSERT INTO taxonomy_mapping (latin, common, created_at, project_id)
        SELECT t.latin, t.common, t.created_at, p.id
        FROM taxonomy_mapping t CROSS JOIN projects p
        WHERE t.project_id IS NULL
    """)
    op.execute("DELETE FROM taxonomy_mapping WHERE project_id IS NULL")
    op.alter_column('taxonomy_mapping', 'project_id', nullable=False)
    op.create_unique_constraint(
        'uq_taxonomy_mapping_project_latin', 'taxonomy_mapping', ['project_id', 'latin'],
    )


def downgrade() -> None:
    # Rows of different projects can share a latin name, which the old
    # global unique index refuses, so the per-project rows go.
    op.execute("DELETE FROM taxonomy_mapping")
    op.drop_constraint('uq_taxonomy_mapping_project_latin', 'taxonomy_mapping', type_='unique')
    op.drop_column('taxonomy_mapping', 'project_id')
    op.create_index('ix_taxonomy_mapping_latin', 'taxonomy_mapping', ['latin'], unique=True)
