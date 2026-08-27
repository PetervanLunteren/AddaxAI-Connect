"""Per-camera rejected file counts.

One grouped query over the rejections table, whatever the number of
cameras. The Cameras page shows the number next to each camera and the
slide-out lists the rows behind it.

The count covers every row still within the 30-day retention, so it is
the same set File management shows. Only rejections that resolved to a
camera at reject time count (missing or invalid GPS, missing date); a file
without a readable device id cannot be attributed and stays visible to
server admins only.

`last_rejected` is there because a count alone cannot separate "sent one
setup shot before the GPS fix, weeks ago" from "rejecting every picture
since this morning". On a real project nearly every camera has the first,
so the attention chip keys on recency, not on the count.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Rejection


@dataclass(frozen=True)
class RejectionStats:
    """Keyed by camera id. A missing key means no rejections."""

    counts: dict[int, int] = field(default_factory=dict)
    # Server wall-clock of the newest rejection, aware UTC.
    last_rejected: dict[int, datetime] = field(default_factory=dict)


async def fetch_rejection_stats(
    db: AsyncSession, camera_ids: list[int]
) -> RejectionStats:
    """Count and newest rejection per camera id, in one grouped query."""
    if not camera_ids:
        return RejectionStats()

    rows = await db.execute(
        select(Rejection.camera_id, func.count(Rejection.id), func.max(Rejection.rejected_at))
        .where(Rejection.camera_id.in_(camera_ids))
        .group_by(Rejection.camera_id)
    )
    counts: dict[int, int] = {}
    last: dict[int, datetime] = {}
    for camera_id, count, newest in rows.all():
        counts[camera_id] = count
        last[camera_id] = newest
    return RejectionStats(counts=counts, last_rejected=last)
