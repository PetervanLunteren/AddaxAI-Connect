"""Add deployments.gps_reading_count for the running-mean pin.

A deployment's pin used to be its first GPS fix, forever. The first fix is
typically the worst reading (taken right after the camera connects to the cell
network), and the relocation check measures every new reading against the pin,
so a bad anchor eats into the 250 m threshold margin and can raise phantom
move candidates. The pin is now the running mean of the deployment's
within-threshold photo readings (shared.geo.next_mean_pin); this column tracks
how many readings the mean already contains. Existing rows start at 1, their
pin is a single reading, and refine as new photos arrive. Closed deployments
keep their current pin, no backfill.

Revision ID: 20260703_dep_running_mean_pin
Revises: 20260616_rejections_feed
Create Date: 2026-07-03

"""
from alembic import op
import sqlalchemy as sa


revision = '20260703_dep_running_mean_pin'
down_revision = '20260616_rejections_feed'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'deployments',
        sa.Column('gps_reading_count', sa.Integer(), nullable=False, server_default='1'),
    )


def downgrade():
    op.drop_column('deployments', 'gps_reading_count')
