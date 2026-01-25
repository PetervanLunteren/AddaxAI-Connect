"""Drop email_allowlist table (replaced by invitation tokens)

Revision ID: 20250125_drop_email_allowlist
Revises: 20250124_add_invitation_tokens
Create Date: 2025-01-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20250125_drop_email_allowlist'
down_revision = '20250124_add_invitation_tokens'
branch_labels = None
depends_on = None


def upgrade():
    """Drop email_allowlist table as it's replaced by secure invitation tokens"""
    # Drop the email_allowlist table
    op.drop_table('email_allowlist')


def downgrade():
    """Recreate email_allowlist table if needed"""
    # Recreate the table structure (in case rollback is needed)
    op.create_table(
        'email_allowlist',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('domain', sa.String(length=255), nullable=True),
        sa.Column('is_superuser', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('added_by_user_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['added_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_email_allowlist_domain'), 'email_allowlist', ['domain'], unique=False)
    op.create_index(op.f('ix_email_allowlist_email'), 'email_allowlist', ['email'], unique=True)
