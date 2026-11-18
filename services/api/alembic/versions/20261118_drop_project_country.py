"""Drop the project country, and give the even-toed order one name.

SpeciesNet no longer geofences on a country: the project's label CSV is what
narrows the labels to a place, and a geofence in front of it only removes
information. Nothing else read the country, so both columns go.

The mapping now reads "cetartiodactyla" and "artiodactyla" as one name,
written "artiodactyla" (shared.taxonomy.normalize_taxon), so stored rows are
renamed to match. A project with a row at both names keeps the label of the
"cetartiodactyla" row: nearly all even-toed predictions carry that name, so
it is the label the project saw until now.

Revision ID: 20261118_drop_project_country
Revises: 20261112_two_factor
Create Date: 2026-11-18

"""
from alembic import op
import sqlalchemy as sa


revision = '20261118_drop_project_country'
down_revision = '20261112_two_factor'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('projects', 'admin1_region')
    op.drop_column('projects', 'country_code')
    op.execute("""
        DELETE FROM taxonomy_mapping a
        USING taxonomy_mapping c
        WHERE a.project_id = c.project_id
          AND a.latin = 'artiodactyla'
          AND c.latin = 'cetartiodactyla'
    """)
    op.execute("UPDATE taxonomy_mapping SET latin = 'artiodactyla' WHERE latin = 'cetartiodactyla'")


def downgrade() -> None:
    # The countries are gone: the columns come back empty, and the older
    # code refuses to classify for a SpeciesNet project until its country is
    # set again. The renamed mapping rows stay as they are.
    op.add_column('projects', sa.Column('country_code', sa.String(3), nullable=True))
    op.add_column('projects', sa.Column('admin1_region', sa.String(10), nullable=True))
