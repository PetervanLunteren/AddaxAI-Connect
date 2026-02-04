"""Add human verification for images

Revision ID: 20260204_add_human_verification
Revises: 20260202_add_report_email
Create Date: 2026-02-04

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic
revision = '20260204_add_human_verification'
down_revision = '20260202_add_report_email'
branch_labels = None
depends_on = None


def upgrade():
    # Create human_observations table
    op.create_table(
        'human_observations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('image_id', sa.Integer(), nullable=False),
        sa.Column('species', sa.String(255), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['image_id'], ['images.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_human_observations_image_id', 'human_observations', ['image_id'])
    op.create_index('idx_human_observations_species', 'human_observations', ['species'])

    # Add verification fields to images table
    op.add_column('images', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('images', sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('images', sa.Column('verified_by_user_id', sa.Integer(), nullable=True))
    op.add_column('images', sa.Column('verification_notes', sa.Text(), nullable=True))

    op.create_foreign_key('fk_images_verified_by_user', 'images', 'users', ['verified_by_user_id'], ['id'])
    op.create_index('idx_images_is_verified', 'images', ['is_verified'])


def downgrade():
    # Remove verification fields from images table
    op.drop_index('idx_images_is_verified', table_name='images')
    op.drop_constraint('fk_images_verified_by_user', 'images', type_='foreignkey')
    op.drop_column('images', 'verification_notes')
    op.drop_column('images', 'verified_by_user_id')
    op.drop_column('images', 'verified_at')
    op.drop_column('images', 'is_verified')

    # Drop human_observations table
    op.drop_index('idx_human_observations_species', table_name='human_observations')
    op.drop_index('idx_human_observations_image_id', table_name='human_observations')
    op.drop_table('human_observations')
