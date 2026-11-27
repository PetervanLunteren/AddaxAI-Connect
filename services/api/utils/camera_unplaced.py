"""Per-camera photos that have no deployment yet.

A photo has no deployment when no deployment covers its capture time: a
camera without GPS that nobody placed yet, or photos older than the first
deployment. One grouped query, whatever the number of cameras. The count
drives the column, the To do line and the callout in the camera panel,
and the first and last day prefill the Set deployment form.

Site-restricted viewers never see these photos (site_scope.site_image_clause
fails closed), so the API gives them None, as for rejected files.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Image


@dataclass(frozen=True)
class UnplacedPhotos:
    count: int
    first_day: date
    last_day: date


async def fetch_unplaced(db: AsyncSession, camera_ids: list[int]) -> dict[int, UnplacedPhotos]:
    """Photos without a deployment per camera id. A missing key means none."""
    if not camera_ids:
        return {}
    rows = await db.execute(
        select(
            Image.camera_id, func.count(Image.id),
            func.min(Image.captured_at), func.max(Image.captured_at),
        )
        .where(Image.camera_id.in_(camera_ids), Image.deployment_id.is_(None))
        .group_by(Image.camera_id)
    )
    return {
        camera_id: UnplacedPhotos(count, first.date(), last.date())
        for camera_id, count, first, last in rows.all()
    }
