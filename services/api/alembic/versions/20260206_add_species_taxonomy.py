"""Add species_taxonomy table

Maps common species names from classification models to scientific names
for CamTrap DP export and other biodiversity standards.

Revision ID: 20260206_add_species_taxonomy
Revises: 20260204_add_human_verification
Create Date: 2026-02-06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260206_add_species_taxonomy'
down_revision = '20260204_add_human_verification'
branch_labels = None
depends_on = None


# DeepFaune v1.4 species taxonomy (38 European wildlife species)
# common_name matches the classification model output stored in classifications.species
DEEPFAUNE_TAXONOMY = [
    ("bison", "Bison bonasus", "species"),
    ("badger", "Meles meles", "species"),
    ("ibex", "Capra ibex", "species"),
    ("beaver", "Castor fiber", "species"),
    ("red_deer", "Cervus elaphus", "species"),
    ("golden_jackal", "Canis aureus", "species"),
    ("chamois", "Rupicapra rupicapra", "species"),
    ("cat", "Felis catus", "species"),
    ("goat", "Capra aegagrus hircus", "species"),
    ("roe_deer", "Capreolus capreolus", "species"),
    ("dog", "Canis lupus familiaris", "species"),
    ("raccoon_dog", "Nyctereutes procyonoides", "species"),
    ("fallow_deer", "Dama dama", "species"),
    ("squirrel", "Sciurus vulgaris", "species"),
    ("moose", "Alces alces", "species"),
    ("equid", None, "family"),  # Equidae - multiple species possible
    ("genet", "Genetta genetta", "species"),
    ("wolverine", "Gulo gulo", "species"),
    ("hedgehog", "Erinaceus europaeus", "species"),
    ("lagomorph", None, "order"),  # Lagomorpha - rabbit/hare not distinguished
    ("wolf", "Canis lupus", "species"),
    ("otter", "Lutra lutra", "species"),
    ("lynx", "Lynx lynx", "species"),
    ("marmot", "Marmota marmota", "species"),
    ("micromammal", None, "class"),  # Mammalia - too broad for single species
    ("mouflon", "Ovis gmelini musimon", "species"),
    ("sheep", "Ovis aries", "species"),
    ("mustelid", None, "family"),  # Mustelidae - multiple species possible
    ("bird", None, "class"),  # Aves - too broad for single species
    ("bear", "Ursus arctos", "species"),
    ("porcupine", "Hystrix cristata", "species"),
    ("nutria", "Myocastor coypus", "species"),
    ("muskrat", "Ondatra zibethicus", "species"),
    ("raccoon", "Procyon lotor", "species"),
    ("fox", "Vulpes vulpes", "species"),
    ("reindeer", "Rangifer tarandus", "species"),
    ("wild_boar", "Sus scrofa", "species"),
    ("cow", "Bos taurus", "species"),
]


def upgrade():
    # Create species_taxonomy table
    op.create_table(
        'species_taxonomy',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('common_name', sa.String(255), nullable=False),
        sa.Column('scientific_name', sa.String(255), nullable=True),
        sa.Column('taxon_rank', sa.String(50), nullable=False, server_default='species'),
        sa.Column('model_source', sa.String(100), nullable=False, server_default='deepfaune'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('common_name', name='uq_species_common_name'),
    )
    op.create_index('idx_species_taxonomy_common_name', 'species_taxonomy', ['common_name'])

    # Pre-populate with DeepFaune v1.4 taxonomy
    species_taxonomy = sa.table(
        'species_taxonomy',
        sa.column('common_name', sa.String),
        sa.column('scientific_name', sa.String),
        sa.column('taxon_rank', sa.String),
        sa.column('model_source', sa.String),
    )
    op.bulk_insert(species_taxonomy, [
        {
            'common_name': common_name,
            'scientific_name': scientific_name,
            'taxon_rank': taxon_rank,
            'model_source': 'deepfaune',
        }
        for common_name, scientific_name, taxon_rank in DEEPFAUNE_TAXONOMY
    ])


def downgrade():
    op.drop_index('idx_species_taxonomy_common_name', table_name='species_taxonomy')
    op.drop_table('species_taxonomy')
