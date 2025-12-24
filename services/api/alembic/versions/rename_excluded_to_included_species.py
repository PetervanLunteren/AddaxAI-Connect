"""Rename excluded_species to included_species with data migration

Revision ID: rename_species_filter
Revises: drop_raw_pred_model
Create Date: 2025-12-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json

# revision identifiers, used by Alembic.
revision = 'rename_species_filter'
down_revision = 'drop_raw_pred_model'
branch_labels = None
depends_on = None

# All 38 DeepFaune species (must match model_loader.py)
ALL_SPECIES = [
    "bison", "badger", "ibex", "beaver", "red_deer", "golden_jackal", "chamois",
    "cat", "goat", "roe_deer", "dog", "raccoon_dog", "fallow_deer", "squirrel",
    "moose", "equid", "genet", "wolverine", "hedgehog", "lagomorph", "wolf",
    "otter", "lynx", "marmot", "micromammal", "mouflon", "sheep", "mustelid",
    "bird", "bear", "porcupine", "nutria", "muskrat", "raccoon", "fox",
    "reindeer", "wild_boar", "cow"
]


def upgrade():
    """
    Migrate from excluded_species to included_species.

    Strategy:
    - NULL excluded_species → NULL included_species (all species allowed)
    - Non-null excluded_species → included_species = all species EXCEPT excluded ones

    This properly inverts the semantic meaning.
    """
    # Add new column
    op.add_column('projects', sa.Column('included_species', postgresql.JSON(astext_type=sa.Text()), nullable=True))

    # Migrate data using raw SQL
    # For each project with excluded_species, set included_species to the complement
    connection = op.get_bind()

    # Get all projects with excluded_species
    result = connection.execute(sa.text("SELECT id, excluded_species FROM projects WHERE excluded_species IS NOT NULL"))

    for row in result:
        project_id = row[0]
        excluded = row[1] if row[1] else []

        # Calculate included species (all species EXCEPT excluded ones)
        if excluded:
            included = [species for species in ALL_SPECIES if species not in excluded]
        else:
            # Empty excluded list means nothing excluded, so all species included → NULL (all allowed)
            included = None

        # Update the project
        if included is not None:
            connection.execute(
                sa.text("UPDATE projects SET included_species = CAST(:included AS jsonb) WHERE id = :id"),
                {"included": json.dumps(included), "id": project_id}
            )

    # Drop old column
    op.drop_column('projects', 'excluded_species')


def downgrade():
    """
    Migrate from included_species back to excluded_species.

    This is the reverse operation.
    """
    # Add old column back
    op.add_column('projects', sa.Column('excluded_species', postgresql.JSON(astext_type=sa.Text()), nullable=True))

    # Migrate data back
    connection = op.get_bind()

    # Get all projects with included_species
    result = connection.execute(sa.text("SELECT id, included_species FROM projects WHERE included_species IS NOT NULL"))

    for row in result:
        project_id = row[0]
        included = row[1] if row[1] else []

        # Calculate excluded species (all species EXCEPT included ones)
        if included:
            excluded = [species for species in ALL_SPECIES if species not in included]
        else:
            # Empty included list shouldn't happen, but treat as NULL
            excluded = None

        # Update the project
        if excluded is not None:
            connection.execute(
                sa.text("UPDATE projects SET excluded_species = CAST(:excluded AS jsonb) WHERE id = :id"),
                {"excluded": json.dumps(excluded), "id": project_id}
            )

    # Drop new column
    op.drop_column('projects', 'included_species')
