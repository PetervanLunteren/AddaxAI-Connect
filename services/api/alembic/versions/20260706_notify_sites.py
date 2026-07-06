"""Convert species-alert scope from cameras to sites

The per-user species-detection alert scope was a list of camera ids
(notification_channels.species_detection.notify_cameras). Scope is now a list
of site ids (notify_sites). This data migration rewrites each stored scope by
mapping every selected camera to its current site; cameras without a site are
dropped from the scope (logged). notify_cameras is removed.

Downgrade drops notify_sites but cannot restore the exact camera scope.

Revision ID: 20260706_notify_sites
Revises: 20260706_site_groups
Create Date: 2026-07-06

"""
import json
import logging

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic
revision = '20260706_notify_sites'
down_revision = '20260706_site_groups'
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def _current_site_ids(conn, camera_ids):
    """Map camera ids to the distinct set of their current site ids."""
    if not camera_ids:
        return []
    rows = conn.execute(
        text(
            """
            SELECT DISTINCT ON (camera_id) site_id
            FROM deployments
            WHERE camera_id = ANY(:cam_ids) AND site_id IS NOT NULL
            ORDER BY camera_id, (end_date IS NULL) DESC, start_date DESC
            """
        ),
        {"cam_ids": list(camera_ids)},
    ).fetchall()
    return sorted({r.site_id for r in rows})


def upgrade():
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT id, notification_channels FROM project_notification_preferences")
    ).fetchall()

    for row in rows:
        channels = row.notification_channels
        if not isinstance(channels, dict):
            continue
        species = channels.get('species_detection')
        if not isinstance(species, dict) or 'notify_cameras' not in species:
            continue

        notify_cameras = species.pop('notify_cameras')
        if isinstance(notify_cameras, list):
            species['notify_sites'] = _current_site_ids(conn, notify_cameras)
        else:
            # null / missing scope meant "all"; keep that by not setting a list.
            species.pop('notify_sites', None)

        conn.execute(
            text(
                "UPDATE project_notification_preferences "
                "SET notification_channels = CAST(:ch AS jsonb) WHERE id = :id"
            ),
            {"ch": json.dumps(channels), "id": row.id},
        )
        logger.info(
            "Notify-scope migration: pref %s converted notify_cameras -> notify_sites",
            row.id,
        )


def downgrade():
    conn = op.get_bind()
    rows = conn.execute(
        text("SELECT id, notification_channels FROM project_notification_preferences")
    ).fetchall()

    for row in rows:
        channels = row.notification_channels
        if not isinstance(channels, dict):
            continue
        species = channels.get('species_detection')
        if not isinstance(species, dict) or 'notify_sites' not in species:
            continue
        species.pop('notify_sites', None)
        conn.execute(
            text(
                "UPDATE project_notification_preferences "
                "SET notification_channels = CAST(:ch AS jsonb) WHERE id = :id"
            ),
            {"ch": json.dumps(channels), "id": row.id},
        )
