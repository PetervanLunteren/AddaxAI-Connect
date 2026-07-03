"""
Deployment reassignment plumbing shared by the deployments, sites, and feed
routers.

Reassigning a deployment to a site always has the same side effects: both
affected sites' pins are recomputed (a pin is the centroid of its
deployments), the camera's now-contiguous same-site deployments are merged,
and the deployment is stamped site_source='manual' to record a human chose
the site. One place for that sequence so the callers cannot drift.
"""
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.deployments import (
    DEPLOYMENT_MERGE_GAP_DAYS,
    FIND_NEXT_MERGEABLE_PAIR_SQL,
    EXTEND_EARLIER_SQL,
    RELINK_IMAGES_SQL,
    DELETE_LATER_SQL,
)
from shared.geo import RECOMPUTE_SITE_LOCATION_SQL
from shared.models import Deployment


async def recompute_site_location(db: AsyncSession, site_id: Optional[int]) -> None:
    """Reset a site's pin to the centroid of its deployments. No-op when site_id
    is None or the site has no deployments."""
    if site_id is None:
        return
    await db.execute(text(RECOMPUTE_SITE_LOCATION_SQL), {"site_id": site_id})


async def merge_camera_contiguous(db: AsyncSession, camera_id: int) -> int:
    """Async twin of shared.deployments.merge_camera_contiguous: merge a camera's
    contiguous same-site deployments and recompute the affected sites, returning
    how many were merged away. Same SQL as the sync helper, run on the request's
    own session so the merge is atomic with the reassignment that triggered it."""
    merged = 0
    affected_sites: set[int] = set()
    while True:
        pair = (
            await db.execute(
                text(FIND_NEXT_MERGEABLE_PAIR_SQL),
                {"camera_id": camera_id, "gap_days": DEPLOYMENT_MERGE_GAP_DAYS},
            )
        ).mappings().first()
        if pair is None:
            break
        params = {"earlier": pair["earlier_id"], "later": pair["later_id"]}
        await db.execute(text(EXTEND_EARLIER_SQL), params)
        await db.execute(text(RELINK_IMAGES_SQL), params)
        await db.execute(text(DELETE_LATER_SQL), {"later": pair["later_id"]})
        affected_sites.add(pair["site_id"])
        merged += 1
    for site_id in affected_sites:
        await recompute_site_location(db, site_id)
    return merged


async def reassign_deployment_site(
    db: AsyncSession, deployment: Deployment, site_id: Optional[int]
) -> int:
    """
    Move a deployment onto a site (None = unassign), with all side effects:
    site_source='manual', both pins recomputed, contiguous merge. Returns how
    many deployments the merge removed. Does not commit. The merge may delete
    `deployment` itself, so callers must not refresh or return it.
    """
    old_site_id = deployment.site_id
    camera_id = deployment.camera_id
    deployment.site_id = site_id
    deployment.site_source = 'manual'
    await db.flush()
    await recompute_site_location(db, old_site_id)
    await recompute_site_location(db, site_id)
    return await merge_camera_contiguous(db, camera_id)
