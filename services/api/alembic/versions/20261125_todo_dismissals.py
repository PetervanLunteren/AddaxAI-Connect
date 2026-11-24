"""Needs attention lines a person dismissed.

Dismiss makes a line quiet for one person: it stays in their list as a
plain row and is not counted on the icon, until an item appears that the
line did not hold when they dismissed it. `keys` are those items (camera,
move, task or file ids, as strings). One row per person and line;
project_id is NULL for a server line.

Revision ID: 20261125_todo_dismissals
Revises: 20261124_statement_answers_move
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa


revision = '20261125_todo_dismissals'
down_revision = '20261124_statement_answers_move'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'todo_dismissals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=True),
        sa.Column('kind', sa.String(50), nullable=False),
        sa.Column('keys', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('todo_dismissals')
