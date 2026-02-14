"""Move timezone from projects to server_settings

Creates server_settings table (single-row, server-wide settings),
migrates timezone from the first project, and drops the column
from projects.

Revision ID: 20260214_tz_to_server_settings
Revises: 20260214_add_blur_ppl_vehicles
Create Date: 2026-02-14

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260214_tz_to_server_settings'
down_revision = '20260214_add_blur_ppl_vehicles'
branch_labels = None
depends_on = None


def upgrade():
    # 1. Create server_settings table
    op.create_table(
        'server_settings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('timezone', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    # 2. Copy timezone from first project (if any projects exist)
    op.execute("""
        INSERT INTO server_settings (timezone)
        SELECT timezone FROM projects ORDER BY id LIMIT 1
    """)

    # 3. If no projects existed, insert a row with NULL timezone
    op.execute("""
        INSERT INTO server_settings (timezone)
        SELECT NULL
        WHERE NOT EXISTS (SELECT 1 FROM server_settings)
    """)

    # 4. Drop timezone column from projects
    op.drop_column('projects', 'timezone')


def downgrade():
    # 1. Re-add timezone column to projects with default UTC
    op.add_column(
        'projects',
        sa.Column('timezone', sa.String(50), nullable=False, server_default='UTC')
    )

    # 2. Copy timezone from server_settings back to all projects
    op.execute("""
        UPDATE projects
        SET timezone = COALESCE(
            (SELECT timezone FROM server_settings LIMIT 1),
            'UTC'
        )
    """)

    # 3. Drop server_settings table
    op.drop_table('server_settings')
