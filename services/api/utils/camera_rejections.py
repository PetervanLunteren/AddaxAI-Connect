"""Per-camera recent rejected files.

One grouped query over the rejections table, whatever the number of
cameras, over the last REJECTED_RECENT_DAYS only. It gives two things per
camera: the count, for the Rejected files column and the slide-out Overview
row, and the time of the latest rejection, which with the latest live image
decides whether the camera is still rejecting (`shared.camera_status.
is_rejecting`). That flag drives the attention chip and the filter.

Recent and not all-time on purpose: a count over the whole 30-day
retention cannot separate "sent one setup shot before the GPS fix, weeks
ago" from "rejecting every picture since this morning". On a real project
nearly every camera has the first (on drenthe 28 of 30), so the column
would read as if every camera had a problem. The full list, older files
included, is in the slide-out tab.

Only rejections that resolved to a camera at reject time count (missing or
invalid GPS, missing date); a file without a readable device id cannot be
attributed and stays visible to server admins only.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import Rejection

# Not shown to users. The column and chip never mention it; the slide-out
# tab splits its list on the same cutoff into recent and older.
REJECTED_RECENT_DAYS = 7


@dataclass(frozen=True)
class RecentRejections:
    """One camera's rejections inside the window."""

    count: int
    last_rejected_at: datetime  # aware UTC server time


async def fetch_recent_rejections(
    db: AsyncSession, camera_ids: list[int], now: datetime | None = None
) -> dict[int, RecentRejections]:
    """Recent rejections per camera id. A missing key means none."""
    if not camera_ids:
        return {}

    since = (now or datetime.now(timezone.utc)) - timedelta(days=REJECTED_RECENT_DAYS)
    rows = await db.execute(
        select(Rejection.camera_id, func.count(Rejection.id), func.max(Rejection.rejected_at))
        .where(Rejection.camera_id.in_(camera_ids), Rejection.rejected_at > since)
        .group_by(Rejection.camera_id)
    )
    return {
        camera_id: RecentRejections(count=count, last_rejected_at=last_rejected_at)
        for camera_id, count, last_rejected_at in rows.all()
    }
