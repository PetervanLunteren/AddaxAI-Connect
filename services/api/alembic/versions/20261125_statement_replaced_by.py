"""Which statement replaced another.

Edit deployment replaces the corrections that made the deployment it
edits, so the days it leaves out go back to the app instead of staying
fixed by an older correction. The replaced rows are marked removed as
before, and now also say which statement replaced them, so Undo of the
edit brings them back.

Revision ID: 20261125_statement_replaced_by
Revises: 20261125_todo_dismissals
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa


revision = '20261125_statement_replaced_by'
down_revision = '20261125_todo_dismissals'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployment_statements', sa.Column(
        'replaced_by_statement_id', sa.Integer(),
        sa.ForeignKey('deployment_statements.id', ondelete='SET NULL'), nullable=True))


def downgrade() -> None:
    op.drop_column('deployment_statements', 'replaced_by_statement_id')
