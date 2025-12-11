"""Add role to users

Revision ID: fa6b78645730
Revises: add_camera_mgmt
Create Date: 2025-12-11 12:00:00.000000

Note: project_id was already added by add_camera_mgmt migration

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'fa6b78645730'
down_revision = 'add_camera_mgmt'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add role column to users table"""
    # Add role column (nullable for now, will be used for RBAC later)
    # Note: project_id was already added by previous migration
    op.add_column('users', sa.Column('role', sa.String(length=50), nullable=True))


def downgrade() -> None:
    """Remove role column from users table"""
    op.drop_column('users', 'role')
