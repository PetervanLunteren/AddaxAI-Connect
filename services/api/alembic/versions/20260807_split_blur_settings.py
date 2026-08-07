"""Split blur_people_vehicles into blur_people and blur_vehicles

People and vehicles get independently configurable privacy blur. Both new
columns start from the project's current combined setting, so nobody's
privacy behaviour changes on update.

Revision ID: 20260807_split_blur_settings
Revises: 20260706_notify_sites
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260807_split_blur_settings'
down_revision = '20260706_notify_sites'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'projects',
        sa.Column('blur_people', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.add_column(
        'projects',
        sa.Column('blur_vehicles', sa.Boolean(), nullable=False, server_default='true'),
    )
    op.execute(
        "UPDATE projects SET blur_people = blur_people_vehicles, "
        "blur_vehicles = blur_people_vehicles"
    )
    op.drop_column('projects', 'blur_people_vehicles')


def downgrade():
    op.add_column(
        'projects',
        sa.Column('blur_people_vehicles', sa.Boolean(), nullable=False, server_default='true'),
    )
    # Combined setting cannot represent a split choice; blur when either was on
    op.execute(
        "UPDATE projects SET blur_people_vehicles = (blur_people OR blur_vehicles)"
    )
    op.drop_column('projects', 'blur_people')
    op.drop_column('projects', 'blur_vehicles')
