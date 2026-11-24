"""Which move a correction answered.

Step 3b of DEPLOYMENTS_PLAN.md. "It stayed at Pond" in the Moves check
writes a statement. answers_move_at records the start of the move it took
back, a raw fact of the decision that never changes. Undo then leads to
exactly that move again: a move is known by its camera and its start,
which come from the photos, not by its row id, which a rebuild may change.

NULL for every other statement (a site set by hand, an upload, the carried
over history) and for corrections made before this column: nothing to
backfill, those did not record it.

Revision ID: 20261124_statement_answers_move
Revises: 20261121_deployment_checked
Create Date: 2026-11-24

"""
from alembic import op
import sqlalchemy as sa


revision = '20261124_statement_answers_move'
down_revision = '20261121_deployment_checked'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployment_statements', sa.Column('answers_move_at', sa.DateTime(timezone=False), nullable=True))


def downgrade() -> None:
    op.drop_column('deployment_statements', 'answers_move_at')
