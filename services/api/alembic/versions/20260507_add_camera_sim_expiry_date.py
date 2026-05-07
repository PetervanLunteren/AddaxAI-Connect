"""Add sim_expiry_date to cameras

Adds an optional Date column so project admins can record when each
camera's SIM card runs out. The new monthly SIM expiry alert reads this
column to email admins about cameras expiring inside the next two
calendar months (or already expired).

Revision ID: 20260507_add_camera_sim_expiry_date
Revises: 20260421_infra_alert_toggles
Create Date: 2026-05-07

"""
from alembic import op
import sqlalchemy as sa


revision = '20260507_add_camera_sim_expiry_date'
down_revision = '20260421_infra_alert_toggles'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('cameras', sa.Column('sim_expiry_date', sa.Date(), nullable=True))


def downgrade():
    op.drop_column('cameras', 'sim_expiry_date')
