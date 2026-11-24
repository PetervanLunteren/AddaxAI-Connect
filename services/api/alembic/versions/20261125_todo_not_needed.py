"""To do lines a person marked not needed.

Three To do lines are a choice, not a fault: a project without a species
list, a server without Telegram, files from cameras nobody registered. A
project or server admin can mark such a line not needed. It is then hidden
for everyone who would see it, with who and when kept, until someone undoes
it. Files from unknown cameras come back when a newer file arrives.

One row per line: project_id is NULL for a server line.

Revision ID: 20261125_todo_not_needed
Revises: 20261124_statement_answers_move
Create Date: 2026-11-25

"""
from alembic import op
import sqlalchemy as sa


revision = '20261125_todo_not_needed'
down_revision = '20261124_statement_answers_move'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'todo_not_needed',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(50), nullable=False),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('todo_not_needed')
