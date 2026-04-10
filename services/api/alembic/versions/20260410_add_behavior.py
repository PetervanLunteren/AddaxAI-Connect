"""Add behavior to human_observations

Standard camera trap annotation field for recording observed animal
behaviour (foraging, traveling, resting, etc.). Matches the CamTrap DP
'behavior' column. American spelling for consistency with the standard.

Revision ID: 20260410_add_behavior
Revises: 20260410_add_sex_life_stage
Create Date: 2026-04-10

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic
revision = '20260410_add_behavior'
down_revision = '20260410_add_sex_life_stage'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('human_observations', sa.Column(
        'behavior', sa.String(50), nullable=False, server_default='unknown'
    ))


def downgrade():
    op.drop_column('human_observations', 'behavior')
