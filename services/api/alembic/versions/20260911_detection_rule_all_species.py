"""Allow detection_alert_rules.species to be null (all labels)

A null species list means the rule fires for every label above the
project's thresholds, the same way a null site_ids means all sites. This
is what lets a connected Sensing Clues project post all detections by
default, and what lets any detection rule be left open to all labels.

Only widens the column to nullable. Existing rows keep their explicit
label lists; nothing is backfilled or rewritten.

Revision ID: 20260911_detection_rule_all_species
Revises: 20260829_project_integrations
Create Date: 2026-09-11

"""
from alembic import op
import sqlalchemy as sa


revision = '20260911_detection_rule_all_species'
down_revision = '20260829_project_integrations'
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        'detection_alert_rules', 'species',
        existing_type=sa.JSON(),
        nullable=True,
    )


def downgrade():
    # Null rows (rules that meant all labels) would violate NOT NULL; clear
    # the integration's default rules before downgrading if any exist.
    op.alter_column(
        'detection_alert_rules', 'species',
        existing_type=sa.JSON(),
        nullable=False,
    )
