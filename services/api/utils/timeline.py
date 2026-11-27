"""
Deployment timeline helper.

Builds the payload for the Insights -> Deployment timeline view. The
WebUI version of this page derives bars from folder structure on disk;
Connect derives them from image arrival in the database.

Each row is a site. Each bar is a `Deployment` (CDP) at that site, so
cameras at one place share a row and a camera swap continues the same
row. Deployments with no resolved site fall back to a per-camera row
(numeric id negated to avoid colliding with site ids). Within a CDP,
solid inner segments are stretches of days with at least one photo on that
deployment; the outer bar runs from its start to the end of its effort
(shared/effort.py). The concurrent strip counts sites that delivered at
least one photo each day.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from statistics import median
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from shared.camera_status import camera_status
from shared import effort
from shared.effort import effort_last_day
from utils.camera_recency import fetch_camera_recency
from utils.timeline_activity import (
    clip_segments_to_window,
    concurrent_from_signal_days,
    daily_camera_counts,
    split_into_segments,
)


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
    include_heatmap: bool = False,
) -> dict:
    """Return the timeline payload as a dict matching `TimelineResponse`.

    `today` is passed in by the router as the server-local calendar date
    so naive camera-clock comparisons remain consistent across the app.

    `include_heatmap` fills the per-site per-day cell list, which only the
    heatmap view mode reads. It is one entry per site per day with data, so
    on demo it was 37,276 of them, 1.79 MB of the 1.8 MB response and very
    nearly all of the 3.2 s the endpoint took. The bars view, which is the
    default, discarded every one of them.
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

    # 2. Per-day photo counts per deployment. Drives the bars, the per-CDP
    #    file_count, the heatmap and the concurrent strip.
    daily_rows = await daily_camera_counts(
        db,
        camera_id_set,
        clip_start=date_from,
        clip_end=date_to,
    )
    days_by_cdp: dict[int, list[date]] = defaultdict(list)
    counts_by_cdp_date: dict[tuple[int, date], int] = {}
    for row in daily_rows:
        if row["deployment_id"] is None:
            continue
        days_by_cdp[row["deployment_id"]].append(row["date"])
        counts_by_cdp_date[(row["deployment_id"], row["date"])] = row["count"]

    # 4. Last contact per camera, source of the status pill. Same rule as the
    #    Cameras page: server receive time of a health report or a live image.
    recency = await fetch_camera_recency(db, camera_id_set)

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

        signal_days_in_cdp = sorted(days_by_cdp.get(row.cdp_id, []))
        effective_end = effort_last_day(
            row.start_date, row.end_date, row.last_photo_at, row.last_day_set,
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

        # Photo days of this deployment inside the date filter. The query
        # already clipped to the filter.
        image_days_in_cdp_window = signal_days_in_cdp
        file_count = sum(
            counts_by_cdp_date.get((row.cdp_id, d), 0)
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
            if include_heatmap:
                heatmap_by_group_date[(gkey, d)] += counts_by_cdp_date.get((row.cdp_id, d), 0)

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

        # The site's status is that of its liveliest candidate camera, so one
        # retired camera on the row cannot mark a live site as silent.
        candidate_cams = (
            open_cameras_by_group.get(gkey)
            or all_cameras_by_group.get(gkey, set())
        )
        grp["camera_status"] = camera_status(
            _latest(recency.last_report_arrival, candidate_cams),
            _latest(recency.last_image_arrival, candidate_cams),
        )

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
    ] if include_heatmap else []

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
            cdp.end_date AS end_date,
            cdp.last_photo_at AS last_photo_at,
            cdp.last_day_set AS last_day_set
        FROM cameras c
        INNER JOIN deployments cdp ON cdp.camera_id = c.id
        LEFT JOIN sites s ON s.id = cdp.site_id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:site_ids AS integer[]) IS NULL OR cdp.site_id = ANY(CAST(:site_ids AS integer[])))
          AND {first_day} <= CAST(:clip_end AS date)
          AND {last_day} >= CAST(:clip_start AS date)
        ORDER BY COALESCE(s.name, c.device_id), cdp.start_date, cdp.id
        """.format(first_day=effort.first_day_sql("cdp"), last_day=effort.last_day_sql("cdp"))
    )
    clip_start = date_from if date_from is not None else date(1900, 1, 1)
    clip_end = date_to if date_to is not None else date(9999, 12, 31)
    return (await db.execute(sql, {
        "project_ids": project_ids,
        "site_ids": site_ids,
        "clip_start": clip_start,
        "clip_end": clip_end,
    })).all()


def _latest(
    stamps_by_camera: dict[int, datetime], camera_ids: set[int]
) -> Optional[datetime]:
    """Newest stamp among `camera_ids`, or None when none of them has one."""
    stamps = [
        stamps_by_camera[cid] for cid in camera_ids if cid in stamps_by_camera
    ]
    return max(stamps) if stamps else None
