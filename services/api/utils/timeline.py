"""
Deployment timeline helper.

Builds the payload for the Insights -> Deployment timeline view. The
WebUI version of this page derives bars from folder structure on disk;
Connect derives them from image arrival in the database.

Each row is a site. Each bar is a `Deployment` (CDP) at that site, so
cameras at one place share a row and a camera swap continues the same
row. Deployments with no resolved site fall back to a per-camera row
(numeric id negated to avoid colliding with site ids). Within a CDP,
solid inner segments are stretches of days with at least one image; the
outer bar is the configured window. The concurrent strip counts sites
that delivered at least one image each day.
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
    concurrent_from_signal_days,
    daily_camera_counts,
    fetch_report_days,
    split_into_segments,
)


def _effective_cdp_end(
    *,
    configured_end: Optional[date],
    start_date: date,
    signal_days_in_cdp: list[date],
) -> date:
    """Resolve the right edge of the outer bar for a single CDP.

    For closed CDPs the configured `end_date` wins. For open CDPs the
    bar stops at the last day with a sign of life (image OR health
    report), or at `start_date` when the camera has never reported
    anything inside the CDP. Replaces the old "extend open CDPs to
    today" rule that made silent cameras look healthy.
    """
    if configured_end is not None:
        return configured_end
    if signal_days_in_cdp:
        return signal_days_in_cdp[-1]
    return start_date


def _group_key(row) -> int:
    """Numeric row id: the site id, or the negated camera id for site-less rows.

    Site ids are positive and camera ids are positive, so negating the camera
    fallback keeps the two id spaces from colliding in one numeric column (the
    chart keys heatmap and transitions by this id).
    """
    return row.site_id if row.site_id is not None else -row.camera_id


async def get_deployment_timeline(
    db: AsyncSession,
    project_ids: list[int],
    *,
    site_ids: Optional[list[int]] = None,
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

    # 1. CDP rows for the project, optionally narrowed by site ids and date filter.
    cdp_rows = await _fetch_cdp_rows(
        db,
        project_ids=project_ids,
        site_ids=site_ids,
        date_from=date_from,
        date_to=date_to,
    )
    if not cdp_rows:
        return _empty_payload()

    camera_id_set = sorted({row.camera_id for row in cdp_rows})

    # 2. Per-day image counts per camera. Drives:
    #    - the per-CDP file_count (via summing rows in the CDP window),
    #    - the heatmap payload (rows passed through unchanged).
    daily_rows = await daily_camera_counts(
        db,
        camera_id_set,
        clip_start=date_from,
        clip_end=date_to,
    )
    image_days_by_camera: dict[int, set[date]] = defaultdict(set)
    counts_by_camera_date: dict[tuple[int, date], int] = {}
    for row in daily_rows:
        image_days_by_camera[row["camera_id"]].add(row["date"])
        counts_by_camera_date[(row["camera_id"], row["date"])] = row["count"]

    # 3. Per-day health reports per camera. A camera that sent a daily
    #    report counts as alive that day even without images. Union with
    #    image days produces the "any sign of life" set used by the bars
    #    and the concurrent strip.
    report_days_by_camera = await fetch_report_days(
        db,
        camera_id_set,
        clip_start=date_from,
        clip_end=date_to,
    )
    signal_days_by_camera: dict[int, list[date]] = {}
    all_cameras_with_signal = set(image_days_by_camera) | set(report_days_by_camera)
    for cid in all_cameras_with_signal:
        merged = image_days_by_camera.get(cid, set()) | set(
            report_days_by_camera.get(cid, [])
        )
        signal_days_by_camera[cid] = sorted(merged)

    # 4. Last health-report per camera, source of the status pill. Driven
    #    by CameraHealthReport, identical rule to the Cameras page.
    last_reported_by_camera = await _fetch_last_reported(db, camera_id_set)

    # 5. Build one row per site (fallback: per camera for site-less deployments).
    groups: dict[int, dict] = {}
    group_signal_days: dict[int, set[date]] = defaultdict(set)
    group_image_days: dict[int, set[date]] = defaultdict(set)
    heatmap_by_group_date: dict[tuple[int, date], int] = defaultdict(int)
    open_cameras_by_group: dict[int, set[int]] = defaultdict(set)
    all_cameras_by_group: dict[int, set[int]] = defaultdict(set)
    cdp_transitions: list[dict] = []
    seen_group: set[int] = set()

    # CDP rows arrive ordered by (site name, start_date), so within a site the
    # loop walks deployments chronologically even across a camera swap.
    for row in cdp_rows:
        camera_id = row.camera_id
        gkey = _group_key(row)
        gname = row.site_name if row.site_id is not None else row.camera_name

        # A transition marks a new deployment at the site (camera swap or the
        # same camera returning), drawn as a tick on the row.
        if gkey in seen_group:
            cdp_transitions.append({
                "site_id": gkey,
                "transition_date": row.start_date,
            })
        seen_group.add(gkey)

        all_cameras_by_group[gkey].add(camera_id)
        if row.end_date is None:
            open_cameras_by_group[gkey].add(camera_id)

        signal_days_in_cdp = _filter_days_to_cdp(
            signal_days_by_camera.get(camera_id, []),
            row.start_date,
            row.end_date,
        )
        effective_end = _effective_cdp_end(
            configured_end=row.end_date,
            start_date=row.start_date,
            signal_days_in_cdp=signal_days_in_cdp,
        )

        # Inner segments: split by gap rule, clip to the CDP window plus
        # the optional date filter so a segment never overflows the bar
        # it belongs to.
        segments = split_into_segments(signal_days_in_cdp)
        clip_start = max(row.start_date, date_from) if date_from else row.start_date
        clip_end = min(effective_end, date_to) if date_to else effective_end
        clipped = clip_segments_to_window(segments, clip_start, clip_end)

        intervals: list[dict] = [
            {"start": s, "end": e, "trap_nights": (e - s).days + 1}
            for s, e in clipped
        ]

        # `file_count` stays image-only; signal days drive the bars but
        # the tooltip is about how many image rows landed in the window.
        image_days_in_cdp_window = [
            d
            for d in image_days_by_camera.get(camera_id, set())
            if row.start_date <= d
            and (row.end_date is None or d <= row.end_date)
            and (date_from is None or d >= date_from)
            and (date_to is None or d <= date_to)
        ]
        file_count = sum(
            counts_by_camera_date.get((camera_id, d), 0)
            for d in image_days_in_cdp_window
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

        # Pool this deployment's in-window signal + image days onto the site so
        # the row ribbon, heatmap, and concurrent strip cover every camera there.
        group_signal_days[gkey].update(signal_days_in_cdp)
        for d in image_days_in_cdp_window:
            group_image_days[gkey].add(d)
            heatmap_by_group_date[(gkey, d)] += counts_by_camera_date.get((camera_id, d), 0)

        grp = groups.get(gkey)
        if grp is None:
            groups[gkey] = {
                "site_id": gkey,
                "site_name": gname,
                "deployments": [deployment],
            }
        else:
            grp["deployments"].append(deployment)

    # Finalise each site row: ribbon from the pooled signal days, and a status
    # pill from a currently-deployed camera (else the most recent reporter).
    for gkey, grp in groups.items():
        all_signal = sorted(group_signal_days.get(gkey, set()))
        site_segments = split_into_segments(all_signal) if all_signal else []
        if date_from is not None or date_to is not None:
            lo = date_from if date_from is not None else date(1, 1, 1)
            hi = date_to if date_to is not None else date(9999, 12, 31)
            site_segments = clip_segments_to_window(site_segments, lo, hi)
        grp["intervals"] = [
            {"start": s, "end": e, "trap_nights": (e - s).days + 1}
            for s, e in site_segments
        ]
        img_days = sorted(group_image_days.get(gkey, set()))
        grp["last_image_day"] = img_days[-1] if img_days else None

        candidate_cams = (
            open_cameras_by_group.get(gkey)
            or all_cameras_by_group.get(gkey, set())
        )
        reports = [
            last_reported_by_camera.get(cid)
            for cid in candidate_cams
            if last_reported_by_camera.get(cid) is not None
        ]
        grp["camera_status"] = camera_status(max(reports) if reports else None)

    sites = sorted(groups.values(), key=lambda s: s["site_name"].lower())

    # 6. Concurrent-sites strip and metrics. Same pooled signal-day source as
    #    the bars so the strip and the bars always agree about a site's state.
    signal_days_by_site = {k: sorted(v) for k, v in group_signal_days.items()}
    concurrent = concurrent_from_signal_days(signal_days_by_site)
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

    heatmap = [
        {"site_id": gkey, "date": d, "count": c}
        for (gkey, d), c in heatmap_by_group_date.items()
    ]

    return {
        "sites": sites,
        "concurrent_cameras": concurrent,
        "heatmap": heatmap,
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
    site_ids: Optional[list[int]],
    date_from: Optional[date],
    date_to: Optional[date],
):
    """Pull every CDP for the project, ordered so the per-site walk is chronological.

    Each row carries its site (nullable). When a site filter is set, only
    deployments at those sites are returned, so the fallback per-camera rows for
    site-less deployments are hidden. Cast handling for the optional site-id
    array keeps a clean postgres plan with or without the filter.
    """
    sql = text(
        """
        SELECT
            c.id   AS camera_id,
            c.device_id AS camera_name,
            cdp.site_id AS site_id,
            s.name AS site_name,
            cdp.id AS cdp_id,
            cdp.deployment_number AS deployment_sequence,
            cdp.start_date AS start_date,
            cdp.end_date AS end_date
        FROM cameras c
        INNER JOIN deployments cdp ON cdp.camera_id = c.id
        LEFT JOIN sites s ON s.id = cdp.site_id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:site_ids AS integer[]) IS NULL OR cdp.site_id = ANY(CAST(:site_ids AS integer[])))
          AND cdp.start_date <= CAST(:clip_end AS date)
          AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:clip_start AS date))
        ORDER BY COALESCE(s.name, c.device_id), cdp.start_date, cdp.id
        """
    )
    clip_start = date_from if date_from is not None else date(1900, 1, 1)
    clip_end = date_to if date_to is not None else date(9999, 12, 31)
    return (await db.execute(sql, {
        "project_ids": project_ids,
        "site_ids": site_ids,
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
