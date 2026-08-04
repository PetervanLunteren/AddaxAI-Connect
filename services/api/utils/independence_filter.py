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

from shared.classification_threshold import CLASSIFICATION_THRESHOLD_FILTER_SQL


# Base CTE that computes independent events from raw observations.
# Parameters: :project_ids, :interval (minutes), plus optional filter params.
#
# The two unverified branches live in _UNVERIFIED_BRANCHES below and are
# substituted into {unverified_branches}. Dropping them gives group sizes that
# come only from counts a person typed, which is what the group-size page wants:
# the AI branches contribute 1 per detection box and read low. Everything after
# raw_obs, the event grouping that actually matters, exists once either way.
_INDEPENDENCE_CTE = """
WITH raw_obs AS (
    -- Verified: human observations
    SELECT i.camera_id, i.deployment_id, ho.species, i.captured_at as ts, ho.count as cnt
    FROM human_observations ho
    JOIN images i ON ho.image_id = i.id
    JOIN cameras c ON i.camera_id = c.id
    WHERE i.is_verified = true AND c.project_id = ANY(:project_ids)
      {verified_filters}{unverified_branches}
),
-- Per-image: sum all detections of same species in same image
img_counts AS (
    SELECT camera_id, deployment_id, species, ts, SUM(cnt) as img_count
    FROM raw_obs GROUP BY camera_id, deployment_id, species, ts
),
-- Pool ID: the "place" an observation belongs to, resolved through its
-- deployment. Sites in a "Merged sites" group share a pool ('g<group_id>');
-- otherwise each site is its own pool ('s<site_id>'); observations without a
-- resolved site fall back to their camera ('c<camera_id>'). Text keys keep the
-- three id spaces from colliding. Resolved per observation (not per camera) so
-- a camera moving between sites is attributed to the site it stood at.
with_pool AS (
    SELECT ic.*,
           COALESCE(
               'g' || s.site_group_id,
               's' || dep.site_id,
               'c' || ic.camera_id
           ) as pool_id
    FROM img_counts ic
    LEFT JOIN deployments dep ON ic.deployment_id = dep.id
    LEFT JOIN sites s ON dep.site_id = s.id
),
-- Compute time gap from previous same-species same-pool observation
with_gaps AS (
    SELECT *, EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (
        PARTITION BY pool_id, species ORDER BY ts
    ))) / 60.0 as gap_min
    FROM with_pool
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
        PARTITION BY pool_id, species ORDER BY ts
    ) as event_id
    FROM with_flags
),
-- Per event: take MAX individuals (same pool seen multiple times)
-- When a pool spans multiple cameras, attribute the event to the camera of
-- the earliest detection.
events AS (
    SELECT (ARRAY_AGG(camera_id ORDER BY ts))[1] as camera_id,
           pool_id, species, event_id,
           MIN(ts) as event_start, MAX(img_count) as event_count
    FROM with_events
    GROUP BY pool_id, species, event_id
)
"""


# The unverified half of raw_obs. Kept separate so it can be left out entirely
# for verified-only statistics. Note both branches count 1 per detection box,
# not a human-asserted number of individuals.
# {classification_filter} is substituted at build time with the per-species
# classification confidence filter (uses cl.confidence and p.classification_thresholds).
_UNVERIFIED_BRANCHES = """
    UNION ALL
    -- Unverified: AI classifications
    SELECT i.camera_id, i.deployment_id, cl.species, i.captured_at as ts, 1 as cnt
    FROM classifications cl
    JOIN detections d ON cl.detection_id = d.id
    JOIN images i ON d.image_id = i.id
    JOIN cameras c ON i.camera_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE i.is_verified = false AND c.project_id = ANY(:project_ids)
      AND d.confidence >= p.detection_threshold
      AND {classification_filter}
      {unverified_filters}
    UNION ALL
    -- Unverified: person/vehicle detections (no classification)
    SELECT i.camera_id, i.deployment_id, d.category as species, i.captured_at as ts, 1 as cnt
    FROM detections d
    JOIN images i ON d.image_id = i.id
    JOIN cameras c ON i.camera_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE i.is_verified = false AND c.project_id = ANY(:project_ids)
      AND d.category IN ('person', 'vehicle')
      AND d.confidence >= p.detection_threshold
      {pv_filters}"""


def _build_unverified_branches(
    unverified_filters: str,
    pv_filters: str,
) -> str:
    """Render the two unverified UNION branches."""
    return _UNVERIFIED_BRANCHES.format(
        unverified_filters=unverified_filters,
        pv_filters=pv_filters,
        classification_filter=CLASSIFICATION_THRESHOLD_FILTER_SQL.strip(),
    )


def _build_filters(
    species_filter: Optional[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    site_ids: Optional[List[int]] = None,
) -> tuple:
    """Build filter clauses and params for the CTE."""
    verified_parts = []
    unverified_parts = []
    pv_parts = []
    params = {}

    if species_filter:
        verified_parts.append("AND LOWER(ho.species) = LOWER(:species_filter)")
        unverified_parts.append("AND LOWER(cl.species) = LOWER(:species_filter)")
        pv_parts.append("AND LOWER(d.category) = LOWER(:species_filter)")
        params["species_filter"] = species_filter

    if start_date:
        verified_parts.append("AND i.captured_at >= :start_date")
        unverified_parts.append("AND i.captured_at >= :start_date")
        pv_parts.append("AND i.captured_at >= :start_date")
        params["start_date"] = start_date

    if end_date:
        verified_parts.append("AND i.captured_at <= :end_date")
        unverified_parts.append("AND i.captured_at <= :end_date")
        pv_parts.append("AND i.captured_at <= :end_date")
        params["end_date"] = end_date

    if site_ids:
        # Filter by place: an image belongs to a site through the deployment
        # active when it was captured. Time-correct, so a camera that moved is
        # counted under the site it stood at, not its current one.
        site_clause = (
            "AND i.deployment_id IN "
            "(SELECT d.id FROM deployments d WHERE d.site_id = ANY(:site_ids))"
        )
        verified_parts.append(site_clause)
        unverified_parts.append(site_clause)
        pv_parts.append(site_clause)
        params["site_ids"] = site_ids

    return (
        "\n      ".join(verified_parts),
        "\n      ".join(unverified_parts),
        "\n      ".join(pv_parts),
        params,
    )


def _build_cte(
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
    verified_only: bool = False,
) -> tuple:
    """Build the full CTE SQL and params dict.

    verified_only drops the two unverified branches, so counts come only from
    human observations. Defaults to False, which reproduces the mixed CTE every
    existing caller relies on.
    """
    verified_filters, unverified_filters, pv_filters, params = _build_filters(
        species_filter, start_date, end_date, site_ids,
    )
    unverified_branches = (
        "" if verified_only
        else _build_unverified_branches(unverified_filters, pv_filters)
    )
    cte_sql = _INDEPENDENCE_CTE.format(
        verified_filters=verified_filters,
        unverified_branches=unverified_branches,
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
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get species counts using independence interval grouping.

    Returns list of {species: str, count: int} sorted by count descending.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date, site_ids)
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


async def get_independent_event_counts(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    species_filter: Optional[str] = None,
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Count distinct independent events per species.

    Returns list of {species: str, count: int} sorted by count descending.
    Unlike get_independent_species_counts (which sums MaxN across events),
    this counts the number of distinct events.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date, site_ids)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    SELECT species, COUNT(*)::int as count
    FROM events
    GROUP BY species
    ORDER BY count DESC
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
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get hourly activity counts using independence interval grouping.

    Returns list of {hour: int, count: int} for hours with data.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date, site_ids)
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


# Labels that are not wildlife. Group size is meaningless for them, and the
# page that uses this is framed as behavioural research. Same set the export
# and naive-occupancy paths treat as non-species.
NON_WILDLIFE_LABELS = ["person", "vehicle", "empty"]


async def get_group_size_distribution(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_list: Optional[List[str]] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
    verified_only: bool = True,
) -> List[dict]:
    """
    Get the distribution of group sizes per species.

    Group size is the event_count already produced by the CTE: the most
    individuals seen in any single image within one independent event (MaxN).

    Returns one row per (species, group_size): {species, group_size, events}.
    Callers derive mean / min / max from these bins.

    species_list filters in this tail rather than in the CTE because
    _build_filters only handles a single species and every other caller wants
    it that way.
    """
    cte_sql, params = _build_cte(
        None, start_date, end_date, site_ids, verified_only=verified_only,
    )
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes
    params["excluded_species"] = NON_WILDLIFE_LABELS

    species_clause = ""
    if species_list:
        species_clause = "AND LOWER(species) = ANY(:species_list)"
        params["species_list"] = [s.lower() for s in species_list]

    query = f"""
    {cte_sql}
    SELECT species, event_count as group_size, COUNT(*)::int as events
    FROM events
    WHERE LOWER(species) <> ALL(:excluded_species)
      {species_clause}
    GROUP BY species, event_count
    ORDER BY species, group_size
    """

    result = await db.execute(text(query), params)
    return [
        {"species": row.species, "group_size": row.group_size, "events": row.events}
        for row in result.all()
    ]


def summarize_group_sizes(rows: List[dict]) -> List[dict]:
    """
    Turn (species, group_size, events) bins into one summary per species.

    Mean is computed from the bins, so it is exact and needs no second query.
    Rows are expected sorted by species then group_size, which the SQL above
    guarantees, but the summary does not rely on it.
    """
    by_species: dict = {}
    for row in rows:
        by_species.setdefault(row["species"], []).append(row)

    summaries = []
    for species, bins in by_species.items():
        bins = sorted(bins, key=lambda b: b["group_size"])
        events = sum(b["events"] for b in bins)
        total_individuals = sum(b["group_size"] * b["events"] for b in bins)
        summaries.append({
            "species": species,
            "events": events,
            "mean": total_individuals / events if events else 0.0,
            "min": bins[0]["group_size"],
            "max": bins[-1]["group_size"],
            "histogram": [
                {"group_size": b["group_size"], "events": b["events"]} for b in bins
            ],
        })

    summaries.sort(key=lambda s: s["events"], reverse=True)
    return summaries


async def get_independent_daily_trend(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get daily detection counts using independence interval grouping.

    Returns list of {date: str, count: int} sorted by date.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date, site_ids)
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


async def get_independent_detection_rate_counts(
    db: AsyncSession,
    project_ids: List[int],
    interval_minutes: int,
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> dict:
    """
    Get per-deployment detection counts using independence interval grouping.

    Returns dict mapping (camera_id, deployment_number) -> event_count
    for use by detection-rate-map endpoint.
    """
    cte_sql, params = _build_cte(species_filter, start_date, end_date, site_ids)
    params["project_ids"] = project_ids
    params["interval"] = interval_minutes

    query = f"""
    {cte_sql}
    , deployment_events AS (
        SELECT cdp.camera_id, cdp.deployment_number as deployment_number,
               SUM(e.event_count)::int as detection_count
        FROM events e
        JOIN deployments cdp ON e.camera_id = cdp.camera_id
            AND DATE(e.event_start) >= cdp.start_date
            AND (cdp.end_date IS NULL OR DATE(e.event_start) <= cdp.end_date)
        GROUP BY cdp.camera_id, cdp.deployment_number
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
    {_INDEPENDENCE_CTE.format(
        verified_filters="",
        unverified_branches=_build_unverified_branches("", ""),
    )}
    , event_boundaries AS (
        SELECT pool_id, species, event_id,
               MIN(ts) as event_start,
               MAX(ts) as event_end,
               MAX(img_count) as event_count
        FROM with_events
        GROUP BY pool_id, species, event_id
    ),
    image_events AS (
        SELECT we.camera_id, we.pool_id, we.species, we.ts, we.event_id,
               eb.event_start, eb.event_end, eb.event_count,
               i.uuid as image_uuid
        FROM with_events we
        JOIN img_counts ic ON we.camera_id = ic.camera_id
            AND we.species = ic.species AND we.ts = ic.ts
        JOIN event_boundaries eb ON we.pool_id = eb.pool_id
            AND we.species = eb.species AND we.event_id = eb.event_id
        JOIN images i ON i.camera_id = we.camera_id AND i.captured_at = we.ts
        JOIN cameras c ON i.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
    )
    SELECT DISTINCT image_uuid, camera_id, pool_id, species, event_id,
           event_start, event_end, event_count
    FROM image_events
    """

    result = await db.execute(text(query), params)
    rows = result.all()

    assignments = {}
    for row in rows:
        key = (row.image_uuid, row.species)
        event_id_str = f"evt-pool{row.pool_id}-{row.species}-{row.event_id}"
        assignments[key] = {
            "event_id": event_id_str,
            "event_start": row.event_start,
            "event_end": row.event_end,
            "event_count": row.event_count,
        }

    return assignments
