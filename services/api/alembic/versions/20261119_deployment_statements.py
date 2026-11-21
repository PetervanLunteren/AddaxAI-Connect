"""Statements about where a camera stood, and times on deployments.

Step 2a of DEPLOYMENTS_PLAN.md. From here deployments are rebuilt per camera
from the GPS readings of its photos plus the statements people made
(shared/deployment_rebuild.py), and a correction is a statement, not a delete.

- deployment_statements: one row per decision.
- deployments.start_at and end_at: the period as times. Filled here from the
  dates (the start of the start day, the start of the day after the end day),
  which gives back the same dates. The rebuild makes them exact.
- server_settings.deployments_carried_over_at: set once by
  scripts/carry_over_deployments.py, which update-database.sh runs after this.
- The held far reading leaves cameras.config. The rebuild reads every reading
  each time, so nothing is kept between two photos.

Revision ID: 20261119_deployment_statements
Revises: 20261119_gps_readings
Create Date: 2026-11-19

"""
from alembic import op
import sqlalchemy as sa


revision = '20261119_deployment_statements'
down_revision = '20261119_gps_readings'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'deployment_statements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('camera_id', sa.Integer(), sa.ForeignKey('cameras.id', ondelete='CASCADE'), nullable=False),
        sa.Column('site_id', sa.Integer(), sa.ForeignKey('sites.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('from_at', sa.DateTime(timezone=False), nullable=False),
        sa.Column('until_at', sa.DateTime(timezone=False), nullable=True),
        sa.Column('fixed_until_at', sa.DateTime(timezone=False), nullable=True),
        sa.Column('source', sa.String(16), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('removed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('removed_by_user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('ix_deployment_statements_id', 'deployment_statements', ['id'])
    op.create_index('ix_deployment_statements_camera_id', 'deployment_statements', ['camera_id'])
    op.create_index('ix_deployment_statements_site_id', 'deployment_statements', ['site_id'])

    op.add_column('deployments', sa.Column('start_at', sa.DateTime(timezone=False), nullable=True))
    op.add_column('deployments', sa.Column('end_at', sa.DateTime(timezone=False), nullable=True))
    op.execute("""
        UPDATE deployments
        SET start_at = start_date::timestamp,
            end_at = (end_date + 1)::timestamp
    """)
    op.alter_column('deployments', 'start_at', nullable=False)

    op.add_column(
        'server_settings',
        sa.Column('deployments_carried_over_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.execute("""
        UPDATE cameras
        SET config = (config::jsonb - 'gps_relocation_candidate')::json
        WHERE config::jsonb ? 'gps_relocation_candidate'
    """)


def downgrade() -> None:
    # Statements are lost, and with them every correction made since the
    # upgrade. The deployments rows stay as the last rebuild left them.
    op.drop_column('server_settings', 'deployments_carried_over_at')
    op.drop_column('deployments', 'end_at')
    op.drop_column('deployments', 'start_at')
    op.drop_table('deployment_statements')
