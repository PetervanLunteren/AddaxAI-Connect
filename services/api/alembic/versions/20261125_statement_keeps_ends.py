"""An end a person moved in Edit deployment stays.

Edit deployment with an earlier last day used to give the days after back
to the GPS, which found the same site and joined them to the deployment
again: the edit seemed to do nothing. Now the statement keeps the ends the
person moved (keeps_start, keeps_end): across such an end the deployment
never joins a neighbour, so shortening it splits it in two, each editable.
An end left as it was still joins. Every statement written before this
keeps joining as it did.

Revision ID: 20261125_statement_keeps_ends
Revises: 20261125_statement_replaced_by
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa


revision = '20261125_statement_keeps_ends'
down_revision = '20261125_statement_replaced_by'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployment_statements', sa.Column('keeps_start', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('deployment_statements', sa.Column('keeps_end', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column('deployment_statements', 'keeps_end')
    op.drop_column('deployment_statements', 'keeps_start')
