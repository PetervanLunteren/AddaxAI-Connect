"""Add project_id and role to user_invitations

Revision ID: 20250114_add_project_and_role_to_invitations
Revises: 20250114_add_user_invitations
Create Date: 2025-01-14 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e257ff9406199'
down_revision = 'c40ddac257ff'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add project_id column (nullable, for server-admin invitations)
    op.add_column('user_invitations', sa.Column('project_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_user_invitations_project_id', 'user_invitations', 'projects', ['project_id'], ['id'], ondelete='CASCADE')
    op.create_index(op.f('ix_user_invitations_project_id'), 'user_invitations', ['project_id'], unique=False)

    # Add role column (not nullable, must specify role)
    # First add as nullable
    op.add_column('user_invitations', sa.Column('role', sa.String(length=50), nullable=True))
    # Set default value for existing rows (if any)
    op.execute("UPDATE user_invitations SET role = 'project-admin' WHERE role IS NULL")
    # Make not nullable
    op.alter_column('user_invitations', 'role', nullable=False)
    op.create_index(op.f('ix_user_invitations_role'), 'user_invitations', ['role'], unique=False)


def downgrade() -> None:
    # Drop role column and its index
    op.drop_index(op.f('ix_user_invitations_role'), table_name='user_invitations')
    op.drop_column('user_invitations', 'role')

    # Drop project_id column, its index, and foreign key
    op.drop_index(op.f('ix_user_invitations_project_id'), table_name='user_invitations')
    op.drop_constraint('fk_user_invitations_project_id', 'user_invitations', type_='foreignkey')
    op.drop_column('user_invitations', 'project_id')
