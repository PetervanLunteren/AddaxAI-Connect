"""Add token, expires_at, and used fields to user_invitations

Revision ID: 20250124_add_invitation_tokens
Revises: 20250115_add_sim_fields
Create Date: 2025-01-24 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20250124_add_invitation_tokens'
down_revision = '20250115_add_sim_fields'
branch_labels = None
depends_on = None


def upgrade():
    """Add secure token fields for invitation-based authentication"""
    # Add token column (unique, indexed) - stores URL-safe secure token
    op.add_column('user_invitations', sa.Column('token', sa.String(length=64), nullable=True))
    op.create_index(op.f('ix_user_invitations_token'), 'user_invitations', ['token'], unique=True)

    # Add expires_at column - invitations expire after 7 days
    op.add_column('user_invitations', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_user_invitations_expires_at'), 'user_invitations', ['expires_at'], unique=False)

    # Add used column - track if invitation has been accepted
    op.add_column('user_invitations', sa.Column('used', sa.Boolean(), nullable=False, server_default='false'))
    op.create_index(op.f('ix_user_invitations_used'), 'user_invitations', ['used'], unique=False)


def downgrade():
    """Remove secure token fields from user_invitations"""
    # Drop indexes and columns
    op.drop_index(op.f('ix_user_invitations_used'), table_name='user_invitations')
    op.drop_column('user_invitations', 'used')

    op.drop_index(op.f('ix_user_invitations_expires_at'), table_name='user_invitations')
    op.drop_column('user_invitations', 'expires_at')

    op.drop_index(op.f('ix_user_invitations_token'), table_name='user_invitations')
    op.drop_column('user_invitations', 'token')
