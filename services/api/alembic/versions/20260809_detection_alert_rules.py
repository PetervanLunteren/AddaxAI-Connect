"""Add detection_alert_rules, seeded from the species_detection blobs

Real-time detection alerts become rules-as-rows, the same architecture as
the camera condition alert rules. Each user's current configuration in
notification_channels.species_detection (one species list plus one sites
list) becomes one seeded telegram-only rule with no extra conditions, so
behaviour is identical on update day.

The species_detection blob key is left in place untouched. Nothing reads
it after this migration, and leaving it makes downgrade a real rollback
(the old matcher would pick it up again) and makes write-backs from stale
cached frontends harmless.

Revision ID: 20260809_detection_alert_rules
Revises: 20260807_camera_alert_rules
Create Date: 2026-08-09

"""
import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = '20260809_detection_alert_rules'
down_revision = '20260807_camera_alert_rules'
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def seed_rules(prefs):
    """Map (user_id, project_id, notification_channels) rows to insert
    dicts, one seeded rule per row with real-time alerts configured.
    Pure so the mapping is unit-testable without a database.

    Mirrors the retired rule engine exactly, strict behaviour preservation:

    - no blob, no species_detection key, or enabled false: no alerts
      today, no rule
    - notify_species missing or empty: matched nothing today, no rule
    - notify_sites an empty list: silenced every site today, no rule
      (an empty site_ids list is also unrepresentable by design)
    - notify_sites missing or null: the legacy every-site bypass, becomes
      site_ids null (all sites)
    - stale site ids carry over as-is, they matched nothing before and
      match nothing after
    - channels ["telegram"], seeded even without a linked chat: such users
      receive nothing until they link, exactly like today, but their
      configuration stays visible and starts working the moment they link
    """
    rules = []
    for user_id, project_id, channels in prefs:
        if not isinstance(channels, dict):
            continue
        cfg = channels.get('species_detection')
        if not isinstance(cfg, dict):
            continue
        if not cfg.get('enabled', False):
            continue
        species = cfg.get('notify_species')
        if not isinstance(species, list) or not species:
            continue
        sites = cfg.get('notify_sites')
        if sites == []:
            continue
        site_ids = list(dict.fromkeys(sites)) if isinstance(sites, list) else None
        rules.append({
            'project_id': project_id,
            'created_by_user_id': user_id,
            'species': list(dict.fromkeys(species)),
            'site_ids': site_ids,
            'channels': ['telegram'],
            'hour_from': None,
            'hour_to': None,
            'min_group_size': None,
            'cooldown_minutes': None,
            'rarity_days': None,
            'is_active': True,
            'cooldown_state': {},
        })
    return rules


detection_alert_rules = sa.table(
    'detection_alert_rules',
    sa.column('project_id', sa.Integer),
    sa.column('created_by_user_id', sa.Integer),
    sa.column('species', sa.JSON),
    sa.column('site_ids', sa.JSON),
    sa.column('channels', sa.JSON),
    sa.column('hour_from', sa.Integer),
    sa.column('hour_to', sa.Integer),
    sa.column('min_group_size', sa.Integer),
    sa.column('cooldown_minutes', sa.Integer),
    sa.column('rarity_days', sa.Integer),
    sa.column('is_active', sa.Boolean),
    sa.column('cooldown_state', sa.JSON),
)


def upgrade():
    op.create_table(
        'detection_alert_rules',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column(
            'project_id',
            sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column(
            'created_by_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='CASCADE'),
            nullable=False,
            index=True,
        ),
        sa.Column('species', sa.JSON(), nullable=False),
        sa.Column('site_ids', sa.JSON(), nullable=True),
        sa.Column('channels', sa.JSON(), nullable=False),
        sa.Column('hour_from', sa.Integer(), nullable=True),
        sa.Column('hour_to', sa.Integer(), nullable=True),
        sa.Column('min_group_size', sa.Integer(), nullable=True),
        sa.Column('cooldown_minutes', sa.Integer(), nullable=True),
        sa.Column('rarity_days', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('cooldown_state', sa.JSON(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    conn = op.get_bind()
    prefs = conn.execute(
        text(
            "SELECT user_id, project_id, notification_channels "
            "FROM project_notification_preferences"
        )
    ).fetchall()

    rules = seed_rules([(r.user_id, r.project_id, r.notification_channels) for r in prefs])
    if rules:
        op.bulk_insert(detection_alert_rules, rules)
    logger.info(
        "Seeded %d detection alert rule(s) from %d preference row(s)",
        len(rules), len(prefs),
    )


def downgrade():
    op.drop_table('detection_alert_rules')
