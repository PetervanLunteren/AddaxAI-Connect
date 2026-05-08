"""Add password_changed_at to users

Foundation for invalidating stale JWTs after a password change. The
JWT strategy compares each token's iat (issued-at) against this column
and rejects tokens issued before the most recent password change.

Existing rows stay NULL, which is interpreted as "never changed" so
old tokens stay valid until their owners change their password (or
their 1 h lifetime expires).

Revision ID: 20260508_add_pw_changed_at
Revises: 20260508_add_project_reminders
Create Date: 2026-05-08

"""
from alembic import op
import sqlalchemy as sa


revision = '20260508_add_pw_changed_at'
down_revision = '20260508_add_project_reminders'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('users', 'password_changed_at')
