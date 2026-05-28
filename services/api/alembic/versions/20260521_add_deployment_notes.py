"""Add notes column to deployments.

Free-text per-deployment notes complement the orientation label (`name`). NULL
means no notes, same shape as `sites.notes`. See future-plans/site-addition.md.

Revision ID: 20260521_add_deployment_notes
Revises: 20260521_drop_camera_name
Create Date: 2026-05-21

"""
from alembic import op
import sqlalchemy as sa


revision = '20260521_add_deployment_notes'
down_revision = '20260521_drop_camera_name'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('deployments', sa.Column('notes', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('deployments', 'notes')
