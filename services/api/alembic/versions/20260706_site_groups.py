"""Replace camera groups with site groups ("Merged sites")

The independence interval now pools by site, not by camera. Cameras at one
site pool automatically, so a group is only for merging distinct sites (e.g.
both ends of a wildlife crossing).

Migration steps:
1. Create site_groups and sites.site_group_id.
2. Convert each existing camera group: map its member cameras to their current
   site. A group spanning 2+ distinct sites becomes a site group; a group whose
   cameras all sit at one site is redundant and is dropped (logged).
3. Drop cameras.camera_group_id and camera_groups.

Downgrade recreates the old schema but cannot restore group membership.

Revision ID: 20260706_site_groups
Revises: 20260703_feed_original_name
Create Date: 2026-07-06

"""
import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic
revision = '20260706_site_groups'
down_revision = '20260703_feed_original_name'
branch_labels = None
depends_on = None

logger = logging.getLogger("alembic.runtime.migration")


def _convert_camera_groups(conn) -> None:
    """Map each camera group to a site group via its cameras' current sites."""
    groups = conn.execute(
        text("SELECT id, project_id, name FROM camera_groups ORDER BY id")
    ).fetchall()

    for group in groups:
        cam_rows = conn.execute(
            text("SELECT id FROM cameras WHERE camera_group_id = :gid"),
            {"gid": group.id},
        ).fetchall()
        cam_ids = [r.id for r in cam_rows]
        if not cam_ids:
            logger.info("Site-group migration: camera group %r has no cameras, dropped", group.name)
            continue

        # Current site per camera: active deployment first, else latest start.
        site_rows = conn.execute(
            text(
                """
                SELECT DISTINCT ON (camera_id) site_id
                FROM deployments
                WHERE camera_id = ANY(:cam_ids) AND site_id IS NOT NULL
                ORDER BY camera_id, (end_date IS NULL) DESC, start_date DESC
                """
            ),
            {"cam_ids": cam_ids},
        ).fetchall()
        site_ids = sorted({r.site_id for r in site_rows})

        if len(site_ids) < 2:
            logger.info(
                "Site-group migration: camera group %r maps to %d site(s), redundant, dropped",
                group.name, len(site_ids),
            )
            continue

        new_id = conn.execute(
            text(
                """
                INSERT INTO site_groups (project_id, name)
                VALUES (:pid, :name)
                RETURNING id
                """
            ),
            {"pid": group.project_id, "name": group.name},
        ).scalar_one()
        conn.execute(
            text("UPDATE sites SET site_group_id = :sgid WHERE id = ANY(:site_ids)"),
            {"sgid": new_id, "site_ids": site_ids},
        )
        logger.info(
            "Site-group migration: camera group %r converted to site group over %d sites",
            group.name, len(site_ids),
        )


def upgrade():
    op.create_table(
        'site_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('project_id', 'name', name='uq_site_group_project_name'),
    )
    op.create_index('ix_site_groups_project_id', 'site_groups', ['project_id'])

    op.add_column('sites', sa.Column(
        'site_group_id', sa.Integer(),
        sa.ForeignKey('site_groups.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.create_index('ix_sites_site_group_id', 'sites', ['site_group_id'])

    _convert_camera_groups(op.get_bind())

    op.drop_index('ix_cameras_camera_group_id', table_name='cameras')
    op.drop_column('cameras', 'camera_group_id')
    op.drop_index('ix_camera_groups_project_id', table_name='camera_groups')
    op.drop_table('camera_groups')


def downgrade():
    op.create_table(
        'camera_groups',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('project_id', 'name', name='uq_camera_group_project_name'),
    )
    op.create_index('ix_camera_groups_project_id', 'camera_groups', ['project_id'])

    op.add_column('cameras', sa.Column(
        'camera_group_id', sa.Integer(),
        sa.ForeignKey('camera_groups.id', ondelete='SET NULL'),
        nullable=True,
    ))
    op.create_index('ix_cameras_camera_group_id', 'cameras', ['camera_group_id'])

    op.drop_index('ix_sites_site_group_id', table_name='sites')
    op.drop_column('sites', 'site_group_id')
    op.drop_index('ix_site_groups_project_id', table_name='site_groups')
    op.drop_table('site_groups')
