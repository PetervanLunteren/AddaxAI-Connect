"""Add sex and life_stage to human_observations

Ecologists need to record sex (male, female, unknown) and life stage
(adult, subadult, juvenile, unknown) per observation. Values match the
CamTrap DP standard. server_default='unknown' backfills existing rows
automatically.

Revision ID: 20260410_add_sex_life_stage
Revises: 20260409_add_class_thresh
Create Date: 2026-04-10

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260410_add_sex_life_stage'
down_revision = '20260409_add_class_thresh'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('human_observations', sa.Column(
        'sex', sa.String(50), nullable=False, server_default='unknown'
    ))
    op.add_column('human_observations', sa.Column(
        'life_stage', sa.String(50), nullable=False, server_default='unknown'
    ))


def downgrade():
    op.drop_column('human_observations', 'life_stage')
    op.drop_column('human_observations', 'sex')
