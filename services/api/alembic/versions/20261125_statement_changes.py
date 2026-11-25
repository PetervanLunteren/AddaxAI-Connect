"""What an Edit or Add deployment changed.

The camera panel says on each deployment card who set it. With this it
says what they set too ("Site and last day set by ..."): the statement
records which of site, first day and last day the person changed. NULL for
older statements and every other kind, which keep the plain "Set by".

Revision ID: 20261125_statement_changes
Revises: 20261125_statement_keeps_ends
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa


revision = '20261125_statement_changes'
down_revision = '20261125_statement_keeps_ends'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployment_statements', sa.Column('changes', sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column('deployment_statements', 'changes')
