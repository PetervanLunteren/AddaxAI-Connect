"""Per-camera rejected file counts.

One grouped query over the rejections table, whatever the number of
cameras. The Cameras page shows the number next to each camera and the
slide-out lists the rows behind it.

The count covers every row still within the 30-day retention, so it is
the same set File management shows. Only rejections that resolved to a
camera at reject time count (missing or invalid GPS, missing date); a file
without a readable device id cannot be attributed and stays visible to
server admins only.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Rejection


async def fetch_rejection_counts(
    db: AsyncSession, camera_ids: list[int]
) -> dict[int, int]:
    """Rejected files per camera id. A missing key means zero."""
    if not camera_ids:
        return {}

    rows = await db.execute(
        select(Rejection.camera_id, func.count(Rejection.id))
        .where(Rejection.camera_id.in_(camera_ids))
        .group_by(Rejection.camera_id)
    )
    return {camera_id: count for camera_id, count in rows.all()}
