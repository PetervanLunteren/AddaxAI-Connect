"""Add Telegram linking tokens for automated account linking

Revision ID: add_telegram_linking_tokens
Revises: remove_signal_support
Create Date: 2025-01-13 13:30:00.000000

Adds support for automated Telegram account linking using secure deep links
with temporary tokens instead of manual Chat ID copy-paste.

Changes:
- Create telegram_linking_tokens table for secure token-based linking
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_telegram_linking_tokens'
down_revision = '20250113_remove_signal_support'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add telegram_linking_tokens table"""

    op.create_table(
        'telegram_linking_tokens',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('token', sa.String(64), nullable=False, unique=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
    )

    # Create indexes for performance
    op.create_index('idx_telegram_linking_tokens_token', 'telegram_linking_tokens', ['token'])
    op.create_index('idx_telegram_linking_tokens_expires_at', 'telegram_linking_tokens', ['expires_at'])


def downgrade() -> None:
    """Remove telegram_linking_tokens table"""

    op.drop_index('idx_telegram_linking_tokens_expires_at', 'telegram_linking_tokens')
    op.drop_index('idx_telegram_linking_tokens_token', 'telegram_linking_tokens')
    op.drop_table('telegram_linking_tokens')
