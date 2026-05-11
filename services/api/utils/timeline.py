"""
Deployment timeline helper.

Builds the payload for the Insights -> Deployment timeline view. The
WebUI version of this page derives bars from folder structure on disk;
Connect derives them from image arrival in the database.

Each row is a camera. Each bar is a `CameraDeploymentPeriod` (CDP).
Within a CDP, solid inner segments are stretches of days with at least
one image; the outer bar is the configured window. The concurrent strip
counts cameras that delivered at least one image each day.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from statistics import median
from typing import Optional

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.models import CameraHealthReport
from utils.camera_status import camera_status
from utils.timeline_activity import (
    clip_segments_to_window,
    concurrent_from_daily,
    daily_camera_counts,
    split_into_segments,
)


def _effective_cdp_end(
    *,
    configured_end: Optional[date],
    start_date: date,
    capture_days_in_cdp: list[date],
) -> date:
    """Resolve the right edge of the outer bar for a single CDP.

    For closed CDPs the configured `end_date` wins. For open CDPs the
    bar stops at the last day with an image, or at `start_date` when the
    camera has never delivered an image inside the CDP. This replaces the
    old behaviour of extending open CDPs to `today`, which made silent
    cameras look healthy.
    """
    if configured_end is not None:
        return configured_end
    if capture_days_in_cdp:
        return capture_days_in_cdp[-1]
    return start_date


async def get_deployment_timeline(
    db: AsyncSession,
    project_ids: list[int],
    *,
    camera_ids: Optional[list[int]] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    today: Optional[date] = None,
) -> dict:
    """Return the timeline payload as a dict matching `TimelineResponse`.

    `today` is passed in by the router as the server-local calendar date
    so naive camera-clock comparisons remain consistent across the app.
    """
    if today is None:
        today = date.today()
    if not project_ids:
        return _empty_payload()

    # 1. CDP rows for the project, optionally narrowed by camera ids and date filter.
    cdp_rows = await _fetch_cdp_rows(
        db,
        project_ids=project_ids,
        camera_ids=camera_ids,
        date_from=date_from,
        date_to=date_to,
    )
    if not cdp_rows:
        return _empty_payload()

    camera_id_set = sorted({row.camera_id for row in cdp_rows})

    # 2. Per-day image counts per camera. Single round-trip that drives:
    #    - the inner bar segments (via the day list),
    #    - the per-CDP file_count (via summing rows in the CDP window),
    #    - the heatmap payload (rows passed through unchanged),
    #    - the concurrent-cameras strip (distinct cameras per day).
    daily_rows = await daily_camera_counts(
        db,
        camera_id_set,
        clip_start=date_from,
        clip_end=date_to,
    )
    days_by_camera: dict[int, list[date]] = defaultdict(list)
    counts_by_camera_date: dict[tuple[int, date], int] = {}
    for row in daily_rows:
        days_by_camera[row["camera_id"]].append(row["date"])
        counts_by_camera_date[(row["camera_id"], row["date"])] = row["count"]
    for camera_id in days_by_camera:
        days_by_camera[camera_id].sort()

    # 3. Last health-report per camera, source of the status pill. Driven
    #    by CameraHealthReport, identical rule to the Cameras page.
    last_reported_by_camera = await _fetch_last_reported(db, camera_id_set)

    # 4. Build sites and deployments.
    sites_by_camera: dict[int, dict] = {}
    cdp_transitions: list[dict] = []
    previous_cdp_by_camera: dict[int, bool] = {}

    # CDP rows arrive ordered by (camera_name, start_date) so the per-camera
    # loop naturally walks deployments in chronological order.
    for row in cdp_rows:
        camera_id = row.camera_id

        if previous_cdp_by_camera.get(camera_id):
            cdp_transitions.append({
                "camera_id": camera_id,
                "transition_date": row.start_date,
            })
        previous_cdp_by_camera[camera_id] = True

        capture_days_in_cdp = _filter_days_to_cdp(
            days_by_camera.get(camera_id, []),
            row.start_date,
            row.end_date,
        )
        effective_end = _effective_cdp_end(
            configured_end=row.end_date,
            start_date=row.start_date,
            capture_days_in_cdp=capture_days_in_cdp,
        )

        # Inner segments: sort, split by gap rule, clip to the CDP window
        # plus the optional date filter so a segment never overflows the
        # bar it belongs to.
        segments = split_into_segments(capture_days_in_cdp)
        clip_start = max(row.start_date, date_from) if date_from else row.start_date
        clip_end = min(effective_end, date_to) if date_to else effective_end
        clipped = clip_segments_to_window(segments, clip_start, clip_end)

        intervals: list[dict] = [
            {"start": s, "end": e, "trap_nights": (e - s).days + 1}
            for s, e in clipped
        ]

        file_count = sum(
            counts_by_camera_date.get((camera_id, d), 0)
            for d in capture_days_in_cdp
            if (date_from is None or d >= date_from)
            and (date_to is None or d <= date_to)
        )

        deployment = {
            "deployment_id": str(row.cdp_id),
            "deployment_label": f"Deployment {row.deployment_sequence}",
            "camera_model": None,
            "configured_start": row.start_date,
            "configured_end": row.end_date,
            "effective_end": effective_end,
            "intervals": intervals,
            "file_count": file_count,
        }

        site = sites_by_camera.get(camera_id)
        if site is None:
            all_days = days_by_camera.get(camera_id, [])
            # Camera-level intervals: split the camera's full day list by the
            # same gap rule, ignoring CDP boundaries. This is what the chart
            # draws as one solid ribbon per camera. CDP boundaries show as
            # ticks on top, not as visual gaps.
            site_segments = split_into_segments(all_days) if all_days else []
            if date_from is not None or date_to is not None:
                lo = date_from if date_from is not None else date(1, 1, 1)
                hi = date_to if date_to is not None else date(9999, 12, 31)
                site_segments = clip_segments_to_window(site_segments, lo, hi)
            site_intervals = [
                {"start": s, "end": e, "trap_nights": (e - s).days + 1}
                for s, e in site_segments
            ]
            sites_by_camera[camera_id] = {
                "site_id": str(camera_id),
                "site_name": row.camera_name,
                "deployments": [deployment],
                "intervals": site_intervals,
                "last_image_day": all_days[-1] if all_days else None,
                "camera_status": camera_status(last_reported_by_camera.get(camera_id)),
            }
        else:
            site["deployments"].append(deployment)

    sites = sorted(sites_by_camera.values(), key=lambda s: s["site_name"].lower())

    # 5. Concurrent-cameras strip and metrics. Trap-night totals come from
    #    the per-camera segments so the visible bars and the caption number
    #    always agree (per-CDP intervals can overlap across CDPs on the
    #    same day during a within-day move).
    concurrent = concurrent_from_daily(daily_rows)
    total_trap_nights = sum(
        iv["trap_nights"]
        for s in sites
        for iv in s.get("intervals", [])
    )
    site_interval_lengths = [
        iv["trap_nights"] for s in sites for iv in s.get("intervals", [])
    ]
    median_len = float(median(site_interval_lengths)) if site_interval_lengths else None
    max_concurrent = max((p["count"] for p in concurrent), default=0)

    # Observed x-axis span. Use effective_end so a fully-silent open CDP
    # does not stretch the chart out to `today`.
    starts = [d["configured_start"] for s in sites for d in s["deployments"]]
    ends: list[date] = []
    for s in sites:
        for d in s["deployments"]:
            ends.append(d["effective_end"])
        for iv in s.get("intervals", []):
            ends.append(iv["end"])
    date_range_from = min(starts) if starts else None
    date_range_to = max(ends) if ends else None
    if date_from is not None and date_range_from is not None:
        date_range_from = max(date_range_from, date_from)
    if date_to is not None and date_range_to is not None:
        date_range_to = min(date_range_to, date_to)

    return {
        "sites": sites,
        "concurrent_cameras": concurrent,
        "heatmap": daily_rows,
        "cdp_transitions": cdp_transitions,
        "metrics": {
            "site_count": len(sites),
            "deployment_count": sum(len(s["deployments"]) for s in sites),
            "total_trap_nights": total_trap_nights,
            "median_deployment_length_days": median_len,
            "max_concurrent_cameras": max_concurrent,
        },
        "date_range_from": date_range_from,
        "date_range_to": date_range_to,
    }


def _empty_payload() -> dict:
    return {
        "sites": [],
        "concurrent_cameras": [],
        "heatmap": [],
        "cdp_transitions": [],
        "metrics": {
            "site_count": 0,
            "deployment_count": 0,
            "total_trap_nights": 0,
            "median_deployment_length_days": None,
            "max_concurrent_cameras": 0,
        },
        "date_range_from": None,
        "date_range_to": None,
    }


async def _fetch_cdp_rows(
    db: AsyncSession,
    *,
    project_ids: list[int],
    camera_ids: Optional[list[int]],
    date_from: Optional[date],
    date_to: Optional[date],
):
    """Pull every CDP for cameras in scope, ordered for the per-camera walk.

    Cast handling for the optional camera-id array mirrors the existing
    pattern in this module's previous version, so the postgres planner
    keeps a clean execution path with or without the filter.
    """
    sql = text(
        """
        SELECT
            c.id   AS camera_id,
            c.name AS camera_name,
            cdp.id AS cdp_id,
            cdp.deployment_id AS deployment_sequence,
            cdp.start_date AS start_date,
            cdp.end_date AS end_date
        FROM cameras c
        INNER JOIN camera_deployment_periods cdp ON cdp.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:camera_ids AS integer[]) IS NULL OR c.id = ANY(CAST(:camera_ids AS integer[])))
          AND cdp.start_date <= CAST(:clip_end AS date)
          AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:clip_start AS date))
        ORDER BY c.name, cdp.start_date, cdp.id
        """
    )
    clip_start = date_from if date_from is not None else date(1900, 1, 1)
    clip_end = date_to if date_to is not None else date(9999, 12, 31)
    return (await db.execute(sql, {
        "project_ids": project_ids,
        "camera_ids": camera_ids,
        "clip_start": clip_start,
        "clip_end": clip_end,
    })).all()


async def _fetch_last_reported(
    db: AsyncSession, camera_ids: list[int]
) -> dict[int, object]:
    """Return the latest `reported_at` per camera, or empty when none."""
    if not camera_ids:
        return {}
    rows = await db.execute(
        select(CameraHealthReport.camera_id, func.max(CameraHealthReport.reported_at))
        .where(CameraHealthReport.camera_id.in_(camera_ids))
        .group_by(CameraHealthReport.camera_id)
    )
    return {camera_id: reported_at for camera_id, reported_at in rows.all()}


def _filter_days_to_cdp(
    days: list[date],
    cdp_start: date,
    cdp_end: Optional[date],
) -> list[date]:
    """Slice the camera's capture days down to those inside one CDP.

    A None `cdp_end` means the CDP is still open; we use a sentinel far
    in the future rather than `today` so callers stay in control of
    server-clock semantics.
    """
    upper = cdp_end if cdp_end is not None else date(9999, 12, 31)
    return [d for d in days if cdp_start <= d <= upper]
