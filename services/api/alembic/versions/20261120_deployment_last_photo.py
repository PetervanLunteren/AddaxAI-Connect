"""The time of the last photo on each deployment.

Step 2c of DEPLOYMENTS_PLAN.md. Effort follows one rule: a camera counts at a
site from its first photo there to its last photo there, and a period a
person fixed counts as the person said (shared/effort.py). The last photo of
an open deployment is what ends its effort, so it is kept on the row.
rebuild_camera keeps it from here; this fills it for existing rows.

Revision ID: 20261120_deployment_last_photo
Revises: 20261119_deployment_statements
Create Date: 2026-11-20

"""
from alembic import op
import sqlalchemy as sa


revision = '20261120_deployment_last_photo'
down_revision = '20261119_deployment_statements'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('deployments', sa.Column('last_photo_at', sa.DateTime(timezone=False), nullable=True))
    op.execute("""
        UPDATE deployments d
        SET last_photo_at = m.last
        FROM (
            SELECT deployment_id, max(captured_at) AS last
            FROM images WHERE deployment_id IS NOT NULL
            GROUP BY deployment_id
        ) m
        WHERE m.deployment_id = d.id
    """)


def downgrade() -> None:
    op.drop_column('deployments', 'last_photo_at')
