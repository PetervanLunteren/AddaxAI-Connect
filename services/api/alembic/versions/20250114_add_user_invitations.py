"""Add user_invitations table for pre-registration project assignments

Revision ID: 20250114_add_user_invitations
Revises: 20250114_rename_is_server_admin
Create Date: 2025-01-14 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'c40ddac257ff'
down_revision = '20250114_rename_is_server_admin'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create user_invitations table
    op.create_table(
        'user_invitations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('invited_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['invited_by_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_index(op.f('ix_user_invitations_id'), 'user_invitations', ['id'], unique=False)
    op.create_index(op.f('ix_user_invitations_email'), 'user_invitations', ['email'], unique=False)


def downgrade() -> None:
    # Drop user_invitations table
    op.drop_index(op.f('ix_user_invitations_email'), table_name='user_invitations')
    op.drop_index(op.f('ix_user_invitations_id'), table_name='user_invitations')
    op.drop_table('user_invitations')
