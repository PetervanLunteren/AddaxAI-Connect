"""
Deployment timeline helper.

Builds the payload for the Insights -> Deployment timeline view. Each row is
a camera (which is Connect's site analogue), and bars within a row are that
camera's `CameraDeploymentPeriod` records. There is no subfolder concept in
Connect, so each deployment renders as a single interval with no rollover-
chain collapse to worry about.

Shape mirrors AddaxAI WebUI's `app/api/crud/timeline.py` so the chart code
ported from WebUI consumes the response unchanged.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from statistics import median
from typing import Iterable, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _concurrent_sweep(intervals: Iterable[tuple[date, date]]) -> List[dict]:
    """Sweep-line over inclusive `(start, end)` intervals.

    Emits one `{date, count}` per distinct day where the running count of
    active intervals changes. Days with no event are omitted; consumers can
    treat the series as a step function. The final point always drops to
    zero so the frontend can close the area chart cleanly.
    """
    intervals = list(intervals)
    if not intervals:
        return []
    events: list[tuple[date, int]] = []
    for start, end in intervals:
        events.append((start, 1))
        events.append((end + timedelta(days=1), -1))
    events.sort(key=lambda e: e[0])

    points: list[dict] = []
    running = 0
    i = 0
    n = len(events)
    while i < n:
        day = events[i][0]
        delta = 0
        while i < n and events[i][0] == day:
            delta += events[i][1]
            i += 1
        running += delta
        points.append({"date": day, "count": running})
    return points


def _clip_interval(
    start: date,
    end: Optional[date],
    *,
    today: date,
    clip_start: Optional[date],
    clip_end: Optional[date],
) -> Optional[tuple[date, date]]:
    """Resolve a `CameraDeploymentPeriod` into a concrete `(start, end)` pair
    clipped to the filter window. `end=None` means "still active" and is
    resolved to `today`. Returns `None` when the interval falls entirely
    outside the window."""
    effective_end = end if end is not None else today
    if effective_end < start:
        return None
    if clip_start is not None and effective_end < clip_start:
        return None
    if clip_end is not None and start > clip_end:
        return None
    s = max(start, clip_start) if clip_start is not None else start
    e = min(effective_end, clip_end) if clip_end is not None else effective_end
    if e < s:
        return None
    return s, e


async def get_deployment_timeline(
    db: AsyncSession,
    project_ids: List[int],
    *,
    camera_ids: Optional[List[int]] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    today: Optional[date] = None,
) -> dict:
    """Return the timeline payload as a dict matching `TimelineResponse`.

    `today` is passed in so the caller can substitute a server-local date
    (matches the project's wall-clock convention) rather than the test
    machine's UTC `date.today()`.
    """
    if today is None:
        today = date.today()
    if not project_ids:
        return {
            "sites": [],
            "concurrent_cameras": [],
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

    # Pull every deployment for cameras in scope, plus the camera name and
    # the image count in the (optionally clipped) window. The image count
    # feeds the per-deployment tooltip; for now we attribute it to the
    # camera rather than splitting across deployments (Connect's images
    # carry camera_id, not deployment_id).
    rows_sql = text(
        """
        SELECT
            c.id   AS camera_id,
            c.name AS camera_name,
            cdp.id AS deployment_id,
            cdp.deployment_id AS deployment_sequence,
            cdp.start_date AS start_date,
            cdp.end_date AS end_date
        FROM cameras c
        INNER JOIN camera_deployment_periods cdp ON cdp.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:camera_ids AS integer[]) IS NULL OR c.id = ANY(CAST(:camera_ids AS integer[])))
          AND cdp.start_date <= CAST(:clip_end AS date)
          AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:clip_start AS date))
        ORDER BY c.name, cdp.start_date
        """
    )
    # Use very wide sentinel bounds so the "no date filter" case still hits
    # both clauses cleanly.
    clip_start_param = date_from if date_from is not None else date(1900, 1, 1)
    clip_end_param = date_to if date_to is not None else date(9999, 12, 31)

    deployment_rows = (await db.execute(rows_sql, {
        "project_ids": project_ids,
        "camera_ids": camera_ids,
        "clip_start": clip_start_param,
        "clip_end": clip_end_param,
    })).all()

    # Image counts per camera in the same window. One row per camera.
    image_counts_sql = text(
        """
        SELECT i.camera_id AS camera_id, COUNT(*) AS file_count
        FROM images i
        INNER JOIN cameras c ON i.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:camera_ids AS integer[]) IS NULL OR i.camera_id = ANY(CAST(:camera_ids AS integer[])))
          AND i.is_hidden = FALSE
          AND i.captured_at::date >= CAST(:clip_start AS date)
          AND i.captured_at::date <= CAST(:clip_end AS date)
        GROUP BY i.camera_id
        """
    )
    image_count_rows = (await db.execute(image_counts_sql, {
        "project_ids": project_ids,
        "camera_ids": camera_ids,
        "clip_start": clip_start_param,
        "clip_end": clip_end_param,
    })).all()
    file_counts_by_camera: dict[int, int] = {
        r.camera_id: int(r.file_count) for r in image_count_rows
    }

    sites_by_camera: dict[int, dict] = {}
    all_intervals: list[tuple[date, date]] = []
    interval_lengths: list[int] = []

    for row in deployment_rows:
        clipped = _clip_interval(
            row.start_date, row.end_date,
            today=today, clip_start=date_from, clip_end=date_to,
        )
        intervals_for_dep: list[dict] = []
        if clipped is not None:
            s, e = clipped
            nights = (e - s).days + 1
            intervals_for_dep.append({"start": s, "end": e, "trap_nights": nights})
            all_intervals.append((s, e))
            interval_lengths.append(nights)

        deployment = {
            "deployment_id": str(row.deployment_id),
            "deployment_label": f"Deployment {row.deployment_sequence}",
            "camera_model": None,
            "configured_start": row.start_date,
            "configured_end": row.end_date,
            "intervals": intervals_for_dep,
            # File count is attributed at the camera level (see note above).
            # The first deployment for a camera carries it; later ones report 0.
            "file_count": 0,
        }
        site = sites_by_camera.get(row.camera_id)
        if site is None:
            sites_by_camera[row.camera_id] = {
                "site_id": str(row.camera_id),
                "site_name": row.camera_name,
                "deployments": [deployment],
            }
            deployment["file_count"] = file_counts_by_camera.get(row.camera_id, 0)
        else:
            site["deployments"].append(deployment)

    sites = sorted(sites_by_camera.values(), key=lambda s: s["site_name"].lower())
    concurrent = _concurrent_sweep(all_intervals)
    total_trap_nights = sum(iv["trap_nights"] for s in sites for d in s["deployments"] for iv in d["intervals"])
    median_len = float(median(interval_lengths)) if interval_lengths else None
    max_concurrent = max((p["count"] for p in concurrent), default=0)

    # Observed x-axis span: earliest configured start to latest of
    # (configured_end, last clipped-interval end), honouring the window.
    starts = [d["configured_start"] for s in sites for d in s["deployments"]]
    ends: list[date] = []
    for s in sites:
        for d in s["deployments"]:
            if d["configured_end"] is not None:
                ends.append(d["configured_end"])
            for iv in d["intervals"]:
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
