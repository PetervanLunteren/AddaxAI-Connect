"""
How the API changes deployments: it writes a statement and rebuilds the
camera. Shared by the deployments, sites, cameras and image routers, so
every correction goes the same way.

Nothing here deletes or edits a deployment row. shared/deployment_rebuild.py
is the only code that writes deployments; it runs on the request's own
session (through run_sync), so a correction and its rebuild are saved
together or not at all.
"""
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deployment_rebuild import rebuild_camera
from shared.geo import is_auto_site_name
from shared.logger import get_logger
from shared.models import Deployment, DeploymentStatement, Image, Site

logger = get_logger("api.deployment_edits")


async def rebuild(db: AsyncSession, camera_ids: Iterable[int]) -> None:
    """Rebuild these cameras' deployments on the request's session."""
    for camera_id in sorted(set(camera_ids)):
        await db.run_sync(lambda session, cid=camera_id: rebuild_camera(session, cid))


async def newest_photo_at(db: AsyncSession, camera_id: int) -> Optional[datetime]:
    return (
        await db.execute(select(func.max(Image.captured_at)).where(Image.camera_id == camera_id))
    ).scalar_one_or_none()


async def state(
    db: AsyncSession,
    camera_id: int,
    site_id: int,
    from_at: datetime,
    until_at: Optional[datetime],
    user_id: Optional[int],
    answers_move_at: Optional[datetime] = None,
    replaces: Iterable[DeploymentStatement] = (),
    removed_by: Optional[int] = None,
    keeps_start: bool = False,
    keeps_end: bool = False,
    changes: Optional[str] = None,
) -> int:
    """
    Record that the camera stood at the site from from_at until until_at, and
    rebuild it. With until_at None the camera is still there: the period is
    fixed up to its newest photo, and after that the GPS carries on, so a
    later move is still seen. answers_move_at is the start of the move this
    takes back, for "It stayed" only. `replaces` are the statements this one
    takes the place of (Edit deployment): they are marked removed, with this
    statement as what replaced them, so Undo brings them back. Returns the
    statement's id, so the screen can offer Undo at once. keeps_start and
    keeps_end mark an end the person moved: the deployment never joins a
    neighbour at the same site across it. changes says what a person changed
    (site, first_day, last_day), for the line on the deployment card. Does
    not commit.
    """
    fixed_until_at = await newest_photo_at(db, camera_id) if until_at is None else None
    statement = DeploymentStatement(
        camera_id=camera_id,
        site_id=site_id,
        from_at=from_at,
        until_at=until_at,
        fixed_until_at=fixed_until_at,
        answers_move_at=answers_move_at,
        keeps_start=keeps_start,
        keeps_end=keeps_end,
        changes=changes,
        source="person",
        created_by_user_id=user_id,
    )
    db.add(statement)
    await db.flush()
    now = datetime.now(timezone.utc)
    for old in replaces:
        old.removed_at = now
        old.removed_by_user_id = removed_by
        old.replaced_by_statement_id = statement.id
    await db.flush()
    await rebuild(db, [camera_id])
    return statement.id


async def previous_deployment(db: AsyncSession, deployment: Deployment) -> Optional[Deployment]:
    """The deployment of the same camera that ends where this one starts."""
    return (
        await db.execute(
            select(Deployment).where(
                Deployment.camera_id == deployment.camera_id,
                Deployment.end_at == deployment.start_at,
            )
        )
    ).scalars().first()


async def site_is_used(db: AsyncSession, site_id: int) -> bool:
    """Whether deployments or statements still point at the site."""
    return bool((
        await db.execute(
            text("""
                SELECT EXISTS (SELECT 1 FROM deployments WHERE site_id = :id)
                    OR EXISTS (SELECT 1 FROM deployment_statements WHERE site_id = :id)
            """),
            {"id": site_id},
        )
    ).scalar())


async def drop_unnamed_sites_left_empty(db: AsyncSession, site_ids: Iterable[Optional[int]]) -> None:
    """After a correction, delete each of these sites that nothing uses any
    more and that still has the name the app gave it. Nobody named it, so
    it was only the app's guess for a place that turned out wrong (a false
    move, a camera put on the wrong site). A site a person named is never
    deleted by the app."""
    for site_id in {s for s in site_ids if s is not None}:
        site = await db.get(Site, site_id)
        if site is not None and is_auto_site_name(site.name) and not await site_is_used(db, site_id):
            await db.delete(site)
            logger.info("Deleted an unnamed site nothing uses any more", site_id=site_id)
    await db.flush()
