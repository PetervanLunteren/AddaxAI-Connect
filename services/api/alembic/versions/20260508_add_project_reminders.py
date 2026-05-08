"""Add project_reminders table

Project admins can schedule a one-shot email reminder tied to a project.
A daily cron at 06:45 UTC scans for due rows and emails the creator.
Sent and cancelled rows are kept (auditable history); never deleted in
the normal flow.

Revision ID: 20260508_add_project_reminders
Revises: 20260507_add_sim_expiry
Create Date: 2026-05-08

"""
from alembic import op
import sqlalchemy as sa


revision = '20260508_add_project_reminders'
down_revision = '20260507_add_sim_expiry'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'project_reminders',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column(
            'project_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('send_on', sa.Date(), nullable=False, index=True),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id'),
            nullable=False,
        ),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'cancelled_by_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id'),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            onupdate=sa.func.now(),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_table('project_reminders')
