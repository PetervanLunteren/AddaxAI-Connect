"""Add role and project_id to users

Revision ID: fa6b78645730
Revises: add_camera_management_schema
Create Date: 2025-12-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fa6b78645730'
down_revision = 'add_camera_management_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add role and project_id columns to users table"""
    # Add role column (nullable for now, will be used for RBAC later)
    op.add_column('users', sa.Column('role', sa.String(length=50), nullable=True))

    # Add project_id column (nullable, will add FK constraint when projects table exists)
    op.add_column('users', sa.Column('project_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove role and project_id columns from users table"""
    op.drop_column('users', 'project_id')
    op.drop_column('users', 'role')
