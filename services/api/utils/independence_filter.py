"""
Independence interval filtering for camera trap statistics.

Groups detections of the same species at the same camera within N minutes
as a single independent event. The count for each event is the maximum
individuals seen in any single image within that event.

This is the standard approach in camera trap ecology (O'Brien et al. 2003),
used by camtrapR, Camelot, eMammal, and Snapshot Safari.
"""
from typing import List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text


# Base CTE that computes independent events from raw observations.
# Parameters: :project_ids, :interval (minutes), plus optional filter params.
_INDEPENDENCE_CTE = """
WITH raw_obs AS (
    -- Verified: human observations
    SELECT i.camera_id, ho.species, i.uploaded_at as ts, ho.count as cnt
    FROM human_observations ho
    JOIN images i ON ho.image_id = i.id
    JOIN cameras c ON i.camera_id = c.id
    WHERE i.is_verified = true AND c.project_id = ANY(:project_ids)
      {verified_filters}
    UNION ALL
    -- Unverified: AI classifications
    SELECT i.camera_id, cl.species, i.uploaded_at as ts, 1 as cnt
    FROM classifications cl
    JOIN detections d ON cl.detection_id = d.id
    JOIN images i ON d.image_id = i.id
    JOIN cameras c ON i.camera_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE i.is_verified = false AND c.project_id = ANY(:project_ids)
      AND d.confidence >= p.detection_threshold
      {unverified_filters}
),
-- Per-image: sum all detections of same species in same image
img_counts AS (
    SELECT camera_id, species, ts, SUM(cnt) as img_count
    FROM raw_obs GROUP BY camera_id, species, ts
),
-- Compute time gap from previous same-species same-camera observation
with_gaps AS (
    SELECT *, EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (
        PARTITION BY camera_id, species ORDER BY ts
    ))) / 60.0 as gap_min
    FROM img_counts
),
-- Flag new independent events
with_flags AS (
    SELECT *, CASE WHEN gap_min IS NULL OR gap_min > :interval
                   THEN 1 ELSE 0 END as new_event
    FROM with_gaps
),
-- Assign event IDs via cumulative sum
with_events AS (
    SELECT *, SUM(new_event) OVER (
        PARTITION BY camera_id, species ORDER BY ts
    ) as event_id
    FROM with_flags
),
-- Per event: take MAX individuals (same group seen multiple times)
events AS (
    SELECT camera_id, species, event_id,
           MIN(ts) as event_start, MAX(img_count) as event_count
    FROM with_events
    GROUP BY camera_id, species, event_id
)
"""


def _build_filters(
    species_filter: Optional[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
) -> tuple:
    """Build filter clauses and params for the CTE."""
    verified_parts = []
    unverified_parts = []
    params = {}

    if species_filter:
        verified_parts.append("AND LOWER(ho.species) = LOWER(:species_filter)")
        unverified_parts.append("AND LOWER(cl.species) = LOWER(:species_filter)")
        params["species_filter"] = species_filter

    if start_date:
        verified_parts.append("AND i.uploaded_at >= :start_date")
        unverified_parts.append("AND i.uploaded_at >= :start_date")
        params["start_date"] = start_date

    if end_date:
        verified_parts.append("AND i.uploaded_at <= :end_date")
        unverified_parts.append("AND i.uploaded_at <= :end_date")
        params["end_date"] = end_date

    return (
        "\n      ".join(verified_parts),
        "\n      ".join(unverified_parts),
        params,
    )


def _build_cte(
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> tuple:
    """Build the full CTE SQL and params dict."""
    verified_filters, unverified_filters, params = _build_filters(
        species_filter, start_date, end_date,
    )
    cte_sql = _INDEPENDENCE_CTE.format(
        verified_filters=verified_filters,
        unverified_filters=unverified_filters,
    )
    return cte_sql, params


async def get_independent_species_counts(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    species_filter: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[dict]:
    """
    Get species counts using independence interval grouping.

    Returns list of {species: str, count: int} sorted by count descending.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    limit_clause = f"LIMIT :limit" if limit else ""
    if limit:
        params["limit"] = limit

    query = f"""
    {cte_sql}
    SELECT species, SUM(event_count)::int as count
    FROM events
    GROUP BY species
    ORDER BY count DESC
    {limit_clause}
    """

    result = await db.execute(text(query), params)
    return [{"species": row.species, "count": row.count} for row in result.all()]


async def get_independent_hourly_activity(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> List[dict]:
    """
    Get hourly activity counts using independence interval grouping.

    Returns list of {hour: int, count: int} for hours with data.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    SELECT EXTRACT(hour FROM event_start)::int as hour,
           SUM(event_count)::int as count
    FROM events
    GROUP BY EXTRACT(hour FROM event_start)
    ORDER BY hour
    """

    result = await db.execute(text(query), params)
    return [{"hour": row.hour, "count": row.count} for row in result.all()]


async def get_independent_daily_trend(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> List[dict]:
    """
    Get daily detection counts using independence interval grouping.

    Returns list of {date: str, count: int} sorted by date.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    SELECT DATE(event_start) as date, SUM(event_count)::int as count
    FROM events
    GROUP BY DATE(event_start)
    ORDER BY date
    """

    result = await db.execute(text(query), params)
    return [{"date": row.date.isoformat(), "count": row.count} for row in result.all()]


async def get_independent_species_camera_matrix(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> List[dict]:
    """
    Get species counts per camera using independence interval grouping.

    Returns list of {camera_name: str, species: str, count: int}.
    """
    cte_sql, params = _build_cte(None, start_date, end_date)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    SELECT c.name as camera_name, events.species,
           SUM(events.event_count)::int as count
    FROM events
    JOIN cameras c ON events.camera_id = c.id
    GROUP BY c.name, events.species
    """

    result = await db.execute(text(query), params)
    return [
        {"camera_name": row.camera_name, "species": row.species, "count": row.count}
        for row in result.all()
    ]


async def get_independent_detection_rate_counts(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> dict:
    """
    Get per-deployment detection counts using independence interval grouping.

    Returns dict mapping (camera_id, deployment_number) -> event_count
    for use by detection-rate-map endpoint.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    , deployment_events AS (
        SELECT cdp.camera_id, cdp.deployment_id as deployment_number,
               SUM(e.event_count)::int as detection_count
        FROM events e
        JOIN camera_deployment_periods cdp ON e.camera_id = cdp.camera_id
            AND DATE(e.event_start) >= cdp.start_date
            AND (cdp.end_date IS NULL OR DATE(e.event_start) <= cdp.end_date)
        GROUP BY cdp.camera_id, cdp.deployment_id
    )
    SELECT camera_id, deployment_number, detection_count FROM deployment_events
    """

    result = await db.execute(text(query), params)
    return {
        (row.camera_id, row.deployment_number): row.detection_count
        for row in result.all()
    }


async def compute_event_assignments(
    db: AsyncSession,
    project_id: int,
    interval_minutes: int,
) -> dict:
    """
    Pre-compute event assignments for all images in a project for CamtrapDP export.

    Returns dict mapping image_uuid -> {
        event_id: str,  # e.g. "evt-{camera_id}-{species}-{event_number}"
        event_start: datetime,
        event_end: datetime,
        event_count: int,  # max individuals in any image within the event
    }

    Images with multiple species get multiple entries keyed by (uuid, species).
    """
    params = {"project_ids": [project_id], "interval": interval_minutes}

    # Extended CTE that also returns per-image info needed for export
    query = f"""
    {_INDEPENDENCE_CTE.format(verified_filters="", unverified_filters="")}
    , event_boundaries AS (
        SELECT camera_id, species, event_id,
               MIN(ts) as event_start,
               MAX(ts) as event_end,
               MAX(img_count) as event_count
        FROM with_events
        GROUP BY camera_id, species, event_id
    ),
    image_events AS (
        SELECT we.camera_id, we.species, we.ts, we.event_id,
               eb.event_start, eb.event_end, eb.event_count,
               i.uuid as image_uuid
        FROM with_events we
        JOIN img_counts ic ON we.camera_id = ic.camera_id
            AND we.species = ic.species AND we.ts = ic.ts
        JOIN event_boundaries eb ON we.camera_id = eb.camera_id
            AND we.species = eb.species AND we.event_id = eb.event_id
        JOIN images i ON i.camera_id = we.camera_id AND i.uploaded_at = we.ts
        JOIN cameras c ON i.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
    )
    SELECT DISTINCT image_uuid, camera_id, species, event_id,
           event_start, event_end, event_count
    FROM image_events
    """

    result = await db.execute(text(query), params)
    rows = result.all()

    assignments = {}
    for row in rows:
        key = (row.image_uuid, row.species)
        event_id_str = f"evt-{row.camera_id}-{row.species}-{row.event_id}"
        assignments[key] = {
            "event_id": event_id_str,
            "event_start": row.event_start,
            "event_end": row.event_end,
            "event_count": row.event_count,
        }

    return assignments
