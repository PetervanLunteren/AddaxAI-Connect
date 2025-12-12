"""add_is_superuser_to_email_allowlist

Revision ID: 3d450ba35253
Revises: fa6b78645730
Create Date: 2025-12-12 09:23:17.334982

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3d450ba35253'
down_revision = 'fa6b78645730'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """
    Add is_superuser column to email_allowlist table.

    This allows allowlist entries to specify if a user should become
    a server admin upon registration.
    """
    # Add is_superuser column with default False
    op.add_column(
        'email_allowlist',
        sa.Column('is_superuser', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    """Remove is_superuser column from email_allowlist table."""
    op.drop_column('email_allowlist', 'is_superuser')
