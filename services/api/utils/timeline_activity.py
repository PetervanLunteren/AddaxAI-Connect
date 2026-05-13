"""Activity helpers for the deployment timeline.

The bars in the chart answer one question per camera per day: "was there
any sign of life from this camera that day". A sign of life is either an
image arrival (`Image.captured_at`) or a daily health report
(`CameraHealthReport.reported_at`). Either one keeps the day filled.
Days with neither show as a gap.

Pure helpers plus a handful of async DB queries, kept in their own file
so `utils/timeline.py` stays focused on shaping the response payload.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import CameraHealthReport, Image


# Any silent day breaks a bar. A gap of `MAX_INNER_BAR_GAP_DAYS + 1` or
# more silent days between two signal-bearing days splits the segment.
# Kept as a parameter rather than inlined so the helper stays generic.
MAX_INNER_BAR_GAP_DAYS = 0


async def fetch_capture_days(
    db: AsyncSession,
    camera_ids: list[int],
    *,
    clip_start: Optional[date] = None,
    clip_end: Optional[date] = None,
) -> dict[int, list[date]]:
    """Return sorted, distinct `captured_at::date` values per camera.

    One round-trip. Hidden images are excluded. Returns an empty dict if
    `camera_ids` is empty (no query issued). The result is keyed by camera
    id; cameras with no images in the window are absent.
    """
    if not camera_ids:
        return {}

    captured_date = func.date(Image.captured_at).label('captured_date')
    stmt = (
        select(Image.camera_id, captured_date)
        .where(Image.camera_id.in_(camera_ids))
        .where(Image.is_hidden == False)  # noqa: E712
        .group_by(Image.camera_id, captured_date)
    )
    if clip_start is not None:
        stmt = stmt.where(captured_date >= clip_start)
    if clip_end is not None:
        stmt = stmt.where(captured_date <= clip_end)
    stmt = stmt.order_by(Image.camera_id, captured_date)

    rows = (await db.execute(stmt)).all()
    out: dict[int, list[date]] = defaultdict(list)
    for camera_id, captured_date_value in rows:
        out[camera_id].append(captured_date_value)
    return dict(out)


def split_into_segments(
    days: Iterable[date],
    max_gap_days: int = MAX_INNER_BAR_GAP_DAYS,
) -> list[tuple[date, date]]:
    """Group sorted distinct days into inclusive `(start, end)` segments.

    A new segment starts whenever the gap between two consecutive days
    exceeds `max_gap_days`. Equivalently, days are merged when they sit
    within `max_gap_days + 1` calendar days of each other.

    Input must already be sorted and de-duplicated; the helper raises
    `ValueError` otherwise so a caller bug surfaces immediately instead
    of producing silently wrong bars.
    """
    seq = list(days)
    if not seq:
        return []
    for prev, curr in zip(seq, seq[1:]):
        if not prev < curr:
            raise ValueError(
                "split_into_segments requires sorted, distinct days; "
                f"got {prev!r} followed by {curr!r}"
            )

    segments: list[tuple[date, date]] = []
    seg_start = seq[0]
    seg_end = seq[0]
    for d in seq[1:]:
        gap = (d - seg_end).days - 1
        if gap > max_gap_days:
            segments.append((seg_start, seg_end))
            seg_start = d
        seg_end = d
    segments.append((seg_start, seg_end))
    return segments


def clip_segments_to_window(
    segments: Iterable[tuple[date, date]],
    window_start: date,
    window_end: date,
) -> list[tuple[date, date]]:
    """Intersect each `(start, end)` segment with `[window_start, window_end]`.

    Drops segments that fall fully outside the window. Empty input yields
    an empty list. Used to clip image-observed segments back into a
    CDP window after they were computed across the camera's whole life.
    """
    if window_end < window_start:
        return []
    out: list[tuple[date, date]] = []
    for seg_start, seg_end in segments:
        if seg_end < window_start or seg_start > window_end:
            continue
        out.append((max(seg_start, window_start), min(seg_end, window_end)))
    return out


async def fetch_report_days(
    db: AsyncSession,
    camera_ids: list[int],
    *,
    clip_start: Optional[date] = None,
    clip_end: Optional[date] = None,
) -> dict[int, list[date]]:
    """Return sorted, distinct `reported_at::date` values per camera.

    A camera that posts a daily health report counts as alive on that
    day even when no images arrive. Returned dict mirrors the shape of
    `fetch_capture_days` so a caller can union the two sets by camera.
    """
    if not camera_ids:
        return {}

    reported_date = func.date(CameraHealthReport.reported_at).label('reported_date')
    stmt = (
        select(CameraHealthReport.camera_id, reported_date)
        .where(CameraHealthReport.camera_id.in_(camera_ids))
        .group_by(CameraHealthReport.camera_id, reported_date)
    )
    if clip_start is not None:
        stmt = stmt.where(reported_date >= clip_start)
    if clip_end is not None:
        stmt = stmt.where(reported_date <= clip_end)
    stmt = stmt.order_by(CameraHealthReport.camera_id, reported_date)

    rows = (await db.execute(stmt)).all()
    out: dict[int, list[date]] = defaultdict(list)
    for camera_id, reported_date_value in rows:
        out[camera_id].append(reported_date_value)
    return dict(out)


async def daily_camera_counts(
    db: AsyncSession,
    camera_ids: list[int],
    *,
    clip_start: Optional[date] = None,
    clip_end: Optional[date] = None,
) -> list[dict]:
    """Return `[{date, camera_id, count}, ...]` for the heatmap and concurrent strip.

    One round-trip. Hidden images are excluded. Cameras with no images in
    the window are simply absent from the result. Returned rows are sorted
    by date then camera_id so the frontend can render in a stable order
    without an extra pass.
    """
    if not camera_ids:
        return []

    captured_date = func.date(Image.captured_at).label('captured_date')
    stmt = (
        select(captured_date, Image.camera_id, func.count(Image.id).label('cnt'))
        .where(Image.camera_id.in_(camera_ids))
        .where(Image.is_hidden == False)  # noqa: E712
        .group_by(captured_date, Image.camera_id)
        .order_by(captured_date, Image.camera_id)
    )
    if clip_start is not None:
        stmt = stmt.where(captured_date >= clip_start)
    if clip_end is not None:
        stmt = stmt.where(captured_date <= clip_end)

    rows = (await db.execute(stmt)).all()
    return [
        {"date": d, "camera_id": int(camera_id), "count": int(cnt)}
        for d, camera_id, cnt in rows
    ]


def concurrent_from_daily(rows: Iterable[dict]) -> list[dict]:
    """Collapse `daily_camera_counts` into a per-day distinct-camera tally.

    Counts cameras that delivered at least one image each day. Use this
    when the concurrent strip should track image delivery; use
    `concurrent_from_signal_days` when it should track any sign of life.
    """
    counts: dict[date, set[int]] = defaultdict(set)
    for row in rows:
        counts[row["date"]].add(row["camera_id"])
    return [
        {"date": d, "count": len(camera_ids)}
        for d, camera_ids in sorted(counts.items())
    ]


def concurrent_from_signal_days(
    signal_days_by_camera: dict[int, Iterable[date]],
) -> list[dict]:
    """Per-day count of cameras with at least one sign of life.

    Sign of life is image OR daily health report (caller decides what
    goes into `signal_days_by_camera`). Same shape as
    `concurrent_from_daily` so the consumer is unchanged.
    """
    per_day: dict[date, int] = defaultdict(int)
    for days in signal_days_by_camera.values():
        for d in days:
            per_day[d] += 1
    return [
        {"date": d, "count": c}
        for d, c in sorted(per_day.items())
    ]
