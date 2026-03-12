"""Add raw_prediction and raw_confidence columns to classifications table

Store full SpeciesNet labels and raw confidence scores for future
taxonomy mapping. DeepFaune classifications leave these columns null.

Revision ID: 20260312_add_raw_prediction
Revises: 20260309_add_image_is_hidden
Create Date: 2026-03-12

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260312_add_raw_prediction'
down_revision = '20260309_add_image_is_hidden'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('classifications', sa.Column('raw_prediction', sa.String(512), nullable=True))
    op.add_column('classifications', sa.Column('raw_confidence', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('classifications', 'raw_confidence')
    op.drop_column('classifications', 'raw_prediction')
