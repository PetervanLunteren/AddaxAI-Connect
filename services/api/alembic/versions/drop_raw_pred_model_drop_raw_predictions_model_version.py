"""Drop raw_predictions and model_version from classifications

Revision ID: drop_raw_pred_model
Revises: add_raw_pred_proj
Create Date: 2025-12-24 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'drop_raw_pred_model'
down_revision = 'add_raw_pred_proj'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop raw_predictions and model_version columns from classifications table"""

    # Drop model_version index first
    op.drop_index(op.f('ix_classifications_model_version'), table_name='classifications')

    # Drop columns
    op.drop_column('classifications', 'model_version')
    op.drop_column('classifications', 'raw_predictions')


def downgrade() -> None:
    """Re-add raw_predictions and model_version columns to classifications table"""

    # Add columns back
    op.add_column('classifications', sa.Column('raw_predictions', postgresql.JSON(astext_type=sa.Text()), nullable=True))
    op.add_column('classifications', sa.Column('model_version', sa.String(length=100), nullable=True))

    # Recreate index
    op.create_index(op.f('ix_classifications_model_version'), 'classifications', ['model_version'], unique=False)
