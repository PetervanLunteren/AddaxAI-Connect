"""
How the API changes deployments: it writes a statement and rebuilds the
camera. Shared by the deployments, feed, sites, cameras and image routers, so
every correction goes the same way.

Nothing here deletes or edits a deployment row. shared/deployment_rebuild.py
is the only code that writes deployments; it runs on the request's own
session (through run_sync), so a correction and its rebuild are saved
together or not at all.
"""
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deployment_rebuild import rebuild_camera
from shared.models import Deployment, DeploymentStatement, Image


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
) -> None:
    """
    Record that the camera stood at the site from from_at until until_at, and
    rebuild it. With until_at None the camera is still there: the period is
    fixed up to its newest photo, and after that the GPS carries on, so a
    later move is still seen. Does not commit.
    """
    fixed_until_at = await newest_photo_at(db, camera_id) if until_at is None else None
    db.add(DeploymentStatement(
        camera_id=camera_id,
        site_id=site_id,
        from_at=from_at,
        until_at=until_at,
        fixed_until_at=fixed_until_at,
        source="person",
        created_by_user_id=user_id,
    ))
    await db.flush()
    await rebuild(db, [camera_id])


async def state_deployment_at_site(
    db: AsyncSession, deployment: Deployment, site_id: int, user_id: Optional[int],
) -> None:
    """The period of this deployment was at this site. Change site in the
    camera panel, and Set site and New site in the updates panel."""
    await state(db, deployment.camera_id, site_id, deployment.start_at, deployment.end_at, user_id)


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
