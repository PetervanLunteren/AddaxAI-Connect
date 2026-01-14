"""Rename is_server_admin to is_superuser

Revision ID: 20250114_rename_is_server_admin
Revises: 20250114_initial_schema
Create Date: 2025-01-14 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20250114_rename_is_server_admin'
down_revision = '20250114_initial_schema'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Rename is_server_admin to is_superuser in users table
    op.alter_column('users', 'is_server_admin',
                    new_column_name='is_superuser',
                    existing_type=sa.Boolean(),
                    existing_nullable=False,
                    existing_server_default=sa.text('false'))

    # Rename is_server_admin to is_superuser in email_allowlist table
    op.alter_column('email_allowlist', 'is_server_admin',
                    new_column_name='is_superuser',
                    existing_type=sa.Boolean(),
                    existing_nullable=False,
                    existing_server_default=sa.text('false'))


def downgrade() -> None:
    # Rename back to is_server_admin in email_allowlist
    op.alter_column('email_allowlist', 'is_superuser',
                    new_column_name='is_server_admin',
                    existing_type=sa.Boolean(),
                    existing_nullable=False,
                    existing_server_default=sa.text('false'))

    # Rename back to is_server_admin in users table
    op.alter_column('users', 'is_superuser',
                    new_column_name='is_server_admin',
                    existing_type=sa.Boolean(),
                    existing_nullable=False,
                    existing_server_default=sa.text('false'))
