"""Add two-factor login

Users can protect their account with a code from an authenticator app, and a
project can require that from everyone who can open it.

On users: the encrypted authenticator secret, the moment two-factor was
switched on (NULL means off), the time step of the last accepted code (so a
code works once), and the hashes of the unused recovery codes. All NULL for
existing users, so nothing changes for them.

On projects: require_two_factor, false for existing projects.

Revision ID: 20261112_two_factor
Revises: 20261030_project_model
Create Date: 2026-11-12

"""
from alembic import op
import sqlalchemy as sa


revision = '20261112_two_factor'
down_revision = '20261030_project_model'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('totp_secret', sa.Text(), nullable=True))
    op.add_column('users', sa.Column('two_factor_enabled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('totp_last_step', sa.BigInteger(), nullable=True))
    op.add_column('users', sa.Column('recovery_code_hashes', sa.JSON(), nullable=True))
    op.add_column(
        'projects',
        sa.Column('require_two_factor', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('projects', 'require_two_factor')
    op.drop_column('users', 'recovery_code_hashes')
    op.drop_column('users', 'totp_last_step')
    op.drop_column('users', 'two_factor_enabled_at')
    op.drop_column('users', 'totp_secret')
