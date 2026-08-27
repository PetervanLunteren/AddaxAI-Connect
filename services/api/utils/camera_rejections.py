"""Per-camera rejected file counts.

One grouped query over the rejections table, whatever the number of
cameras. Two counts per camera:

- `counts`: every row still within the 30-day retention, the same set File
  management shows. The slide-out Overview row and the Rejected tab use it.
- `recent_counts`: the last REJECTED_RECENT_DAYS only. The Cameras column,
  the attention chip and the filter use it, because a count alone cannot
  separate "sent one setup shot before the GPS fix, weeks ago" from
  "rejecting every picture since this morning". On a real project nearly
  every camera has the first (on drenthe 28 of 30), so the column would
  read as if every camera had a problem.

Only rejections that resolved to a camera at reject time count (missing or
invalid GPS, missing date); a file without a readable device id cannot be
attributed and stays visible to server admins only.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Rejection

# Not shown to users. The column and chip just say "rejected files"; the
# slide-out says 30 days because that one is the retention window.
REJECTED_RECENT_DAYS = 7


@dataclass(frozen=True)
class RejectionStats:
    """Keyed by camera id. A missing key means zero."""

    counts: dict[int, int] = field(default_factory=dict)
    recent_counts: dict[int, int] = field(default_factory=dict)


async def fetch_rejection_stats(
    db: AsyncSession, camera_ids: list[int], now: datetime | None = None
) -> RejectionStats:
    """Total and recent rejections per camera id, in one grouped query."""
    if not camera_ids:
        return RejectionStats()

    since = (now or datetime.now(timezone.utc)) - timedelta(days=REJECTED_RECENT_DAYS)
    rows = await db.execute(
        select(
            Rejection.camera_id,
            func.count(Rejection.id),
            func.count(Rejection.id).filter(Rejection.rejected_at > since),
        )
        .where(Rejection.camera_id.in_(camera_ids))
        .group_by(Rejection.camera_id)
    )
    counts: dict[int, int] = {}
    recent: dict[int, int] = {}
    for camera_id, total, last_week in rows.all():
        counts[camera_id] = total
        recent[camera_id] = last_week
    return RejectionStats(counts=counts, recent_counts=recent)
