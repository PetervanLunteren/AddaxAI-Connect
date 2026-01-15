"""Add SIM fields to cameras table

Revision ID: 20250115_add_sim_fields
Revises: 20250114_add_project_and_role_to_invitations
Create Date: 2025-01-15

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20250115_add_sim_fields'
down_revision = 'e257ff9406199'
branch_labels = None
depends_on = None


def upgrade():
    """Add SIM card information fields to cameras table"""
    # Add new columns for SIM card tracking
    op.add_column('cameras', sa.Column('firmware', sa.String(length=100), nullable=True))
    op.add_column('cameras', sa.Column('remark', sa.Text(), nullable=True))
    op.add_column('cameras', sa.Column('has_sim', sa.Boolean(), nullable=True))
    op.add_column('cameras', sa.Column('imsi', sa.String(length=50), nullable=True))
    op.add_column('cameras', sa.Column('iccid', sa.String(length=50), nullable=True))

    # Add indexes for IMSI and ICCID for faster lookups
    op.create_index(op.f('ix_cameras_imsi'), 'cameras', ['imsi'], unique=False)
    op.create_index(op.f('ix_cameras_iccid'), 'cameras', ['iccid'], unique=False)


def downgrade():
    """Remove SIM card information fields from cameras table"""
    # Drop indexes
    op.drop_index(op.f('ix_cameras_iccid'), table_name='cameras')
    op.drop_index(op.f('ix_cameras_imsi'), table_name='cameras')

    # Drop columns
    op.drop_column('cameras', 'iccid')
    op.drop_column('cameras', 'imsi')
    op.drop_column('cameras', 'has_sim')
    op.drop_column('cameras', 'remark')
    op.drop_column('cameras', 'firmware')
