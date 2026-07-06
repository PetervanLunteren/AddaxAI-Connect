"""
Utility functions for querying species counts with human verification preference.

When an image is verified, uses HumanObservation data.
When not verified, falls back to AI Detection/Classification data.
"""
from typing import Dict, List, Optional, Tuple
from datetime import date, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, union_all, literal, text

from shared.classification_threshold import classification_passes_threshold


def _site_image_condition(site_ids: List[int]):
    """SQLAlchemy condition restricting images to a set of sites.

    Resolved through each image's deployment, so it is time-correct: an image
    counts for the site its deployment stood at when captured, not the camera's
    current site.
    """
    from shared.models import Image, Deployment
    return Image.deployment_id.in_(
        select(Deployment.id).where(Deployment.site_id.in_(site_ids))
    )


async def get_preferred_species_counts(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
    species_filter: Optional[str] = None,
    limit: Optional[int] = None,
) -> List[dict]:
    """
    Get species counts preferring human observations over AI predictions.

    For verified images: uses HumanObservation.count (summed per species)
    For unverified images: uses Detection/Classification count (1 per detection)

    Returns list of {species: str, count: int} sorted by count descending.
    """
    from shared.models import Image, Camera, Project, Detection, Classification, HumanObservation

    # Build common filters for both queries
    verified_filters = [
        Image.is_verified == True,
        Camera.project_id.in_(project_ids),
    ]
    unverified_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
    ]

    if start_date:
        verified_filters.append(Image.captured_at >= start_date)
        unverified_filters.append(Image.captured_at >= start_date)
    if end_date:
        verified_filters.append(Image.captured_at <= end_date)
        unverified_filters.append(Image.captured_at <= end_date)
    if site_ids:
        verified_filters.append(_site_image_condition(site_ids))
        unverified_filters.append(_site_image_condition(site_ids))
    # Person/vehicle filters (unverified images with detection category)
    pv_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
        Detection.category.in_(['person', 'vehicle']),
    ]

    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())
        pv_filters.append(func.lower(Detection.category) == species_filter.lower())
    if start_date:
        pv_filters.append(Image.captured_at >= start_date)
    if end_date:
        pv_filters.append(Image.captured_at <= end_date)
    if site_ids:
        pv_filters.append(_site_image_condition(site_ids))

    # Query 1: Verified images - use HumanObservation
    verified_query = (
        select(
            HumanObservation.species.label('species'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(HumanObservation.species)
    )

    # Query 2: Unverified images - use AI Detection/Classification with threshold
    unverified_query = (
        select(
            Classification.species.label('species'),
            func.count(Classification.id).label('count')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        .group_by(Classification.species)
    )

    # Query 3: Unverified person/vehicle detections (no classification records)
    pv_query = (
        select(
            Detection.category.label('species'),
            func.count(Detection.id).label('count')
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *pv_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Detection.category)
    )

    # Combine with UNION ALL and sum again to merge same species from both sources
    combined = union_all(verified_query, unverified_query, pv_query).subquery()

    final_query = (
        select(
            combined.c.species,
            func.sum(combined.c.count).label('total_count')
        )
        .group_by(combined.c.species)
        .order_by(func.sum(combined.c.count).desc())
    )

    if limit:
        final_query = final_query.limit(limit)

    result = await db.execute(final_query)
    rows = result.all()

    return [{'species': row.species, 'count': int(row.total_count)} for row in rows]


async def get_preferred_unique_species(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[str]:
    """
    Get list of unique species from preferred data source.

    Returns all species found in either human observations (for verified images)
    or AI classifications (for unverified images).
    """
    from shared.models import Image, Camera, Project, Detection, Classification, HumanObservation

    # Build common filters
    verified_filters = [
        Image.is_verified == True,
        Camera.project_id.in_(project_ids),
    ]
    unverified_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
    ]

    pv_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
        Detection.category.in_(['person', 'vehicle']),
    ]

    if start_date:
        verified_filters.append(Image.captured_at >= start_date)
        unverified_filters.append(Image.captured_at >= start_date)
        pv_filters.append(Image.captured_at >= start_date)
    if end_date:
        verified_filters.append(Image.captured_at <= end_date)
        unverified_filters.append(Image.captured_at <= end_date)
        pv_filters.append(Image.captured_at <= end_date)
    if site_ids:
        verified_filters.append(_site_image_condition(site_ids))
        unverified_filters.append(_site_image_condition(site_ids))
        pv_filters.append(_site_image_condition(site_ids))

    # Species from verified images (human observations)
    verified_species = (
        select(HumanObservation.species.label('species'))
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .distinct()
    )

    # Species from unverified images (AI classifications)
    unverified_species = (
        select(Classification.species.label('species'))
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        .distinct()
    )

    # Person/vehicle categories from unverified images
    pv_species = (
        select(Detection.category.label('species'))
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *pv_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .distinct()
    )

    # Combine and get unique
    combined = union_all(verified_species, unverified_species, pv_species).subquery()
    final_query = select(combined.c.species).distinct().order_by(combined.c.species)

    result = await db.execute(final_query)
    return [row.species for row in result.all()]


async def get_preferred_total_species_count(
    db: AsyncSession,
    project_ids: List[int],
    site_ids: Optional[List[int]] = None,
) -> int:
    """
    Get total unique species count from preferred data source.
    """
    species_list = await get_preferred_unique_species(db, project_ids, site_ids=site_ids)
    return len(species_list)


async def get_preferred_hourly_activity(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get hourly activity counts (0-23) from preferred data source.

    Uses image capture time for hour extraction.
    For verified images: counts from HumanObservation
    For unverified: counts from Classification

    Returns list of {hour: int, count: int} for hours with data.
    """
    from shared.models import Image, Camera, Project, Detection, Classification, HumanObservation

    # Common filters
    verified_filters = [
        Image.is_verified == True,
        Camera.project_id.in_(project_ids),
    ]
    unverified_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
    ]

    pv_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
        Detection.category.in_(['person', 'vehicle']),
    ]

    if start_date:
        verified_filters.append(Image.captured_at >= start_date)
        unverified_filters.append(Image.captured_at >= start_date)
        pv_filters.append(Image.captured_at >= start_date)
    if end_date:
        verified_filters.append(Image.captured_at <= end_date)
        unverified_filters.append(Image.captured_at <= end_date)
        pv_filters.append(Image.captured_at <= end_date)
    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())
        pv_filters.append(func.lower(Detection.category) == species_filter.lower())
    if site_ids:
        verified_filters.append(_site_image_condition(site_ids))
        unverified_filters.append(_site_image_condition(site_ids))
        pv_filters.append(_site_image_condition(site_ids))

    # Verified: group by hour, sum counts from HumanObservation
    verified_query = (
        select(
            func.extract('hour', Image.captured_at).label('hour'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(func.extract('hour', Image.captured_at))
    )

    # Unverified: group by hour, count classifications
    unverified_query = (
        select(
            func.extract('hour', Image.captured_at).label('hour'),
            func.count(Classification.id).label('count')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        .group_by(func.extract('hour', Image.captured_at))
    )

    # Person/vehicle: group by hour, count detections
    pv_query = (
        select(
            func.extract('hour', Image.captured_at).label('hour'),
            func.count(Detection.id).label('count')
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *pv_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(func.extract('hour', Image.captured_at))
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query, pv_query).subquery()
    final_query = (
        select(
            combined.c.hour,
            func.sum(combined.c.count).label('total_count')
        )
        .group_by(combined.c.hour)
        .order_by(combined.c.hour)
    )

    result = await db.execute(final_query)
    return [{'hour': int(row.hour), 'count': int(row.total_count)} for row in result.all()]


async def get_preferred_species_first_dates(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get the first observation date for each species from preferred data source.

    For each species, returns the earliest date it was observed across both
    verified (human) and unverified (AI) images.

    Returns list of {species: str, first_date: date}.
    """
    from shared.models import Image, Camera, Project, Detection, Classification, HumanObservation

    # Common filters
    verified_filters = [
        Image.is_verified == True,
        Camera.project_id.in_(project_ids),
    ]
    unverified_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
    ]

    pv_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
        Detection.category.in_(['person', 'vehicle']),
    ]

    if start_date:
        verified_filters.append(Image.captured_at >= start_date)
        unverified_filters.append(Image.captured_at >= start_date)
        pv_filters.append(Image.captured_at >= start_date)
    if end_date:
        verified_filters.append(Image.captured_at <= end_date)
        unverified_filters.append(Image.captured_at <= end_date)
        pv_filters.append(Image.captured_at <= end_date)
    if site_ids:
        verified_filters.append(_site_image_condition(site_ids))
        unverified_filters.append(_site_image_condition(site_ids))
        pv_filters.append(_site_image_condition(site_ids))

    # Verified: first date from human observations
    verified_query = (
        select(
            HumanObservation.species.label('species'),
            func.min(func.date(Image.captured_at)).label('first_date')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(HumanObservation.species)
    )

    # Unverified: first date from AI classifications
    unverified_query = (
        select(
            Classification.species.label('species'),
            func.min(func.date(Image.captured_at)).label('first_date')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        .group_by(Classification.species)
    )

    # Person/vehicle: first date from detection category
    pv_query = (
        select(
            Detection.category.label('species'),
            func.min(func.date(Image.captured_at)).label('first_date')
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *pv_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Detection.category)
    )

    # Combine and get min date per species (earliest across both sources)
    combined = union_all(verified_query, unverified_query, pv_query).subquery()
    final_query = (
        select(
            combined.c.species,
            func.min(combined.c.first_date).label('first_date')
        )
        .group_by(combined.c.species)
        .order_by(func.min(combined.c.first_date))
    )

    result = await db.execute(final_query)
    return [{'species': row.species, 'first_date': row.first_date} for row in result.all()]


async def get_preferred_daily_trend(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get daily detection counts from preferred data source.

    For verified images: sums from HumanObservation.count
    For unverified: counts from Classification

    Returns list of {date: str, count: int} sorted by date.
    """
    from shared.models import Image, Camera, Project, Detection, Classification, HumanObservation

    # Common filters
    verified_filters = [
        Image.is_verified == True,
        Camera.project_id.in_(project_ids),
    ]
    unverified_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
    ]

    pv_filters = [
        Image.is_verified == False,
        Camera.project_id.in_(project_ids),
        Detection.category.in_(['person', 'vehicle']),
    ]

    if start_date:
        verified_filters.append(Image.captured_at >= start_date)
        unverified_filters.append(Image.captured_at >= start_date)
        pv_filters.append(Image.captured_at >= start_date)
    if end_date:
        verified_filters.append(Image.captured_at <= end_date)
        unverified_filters.append(Image.captured_at <= end_date)
        pv_filters.append(Image.captured_at <= end_date)
    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())
        pv_filters.append(func.lower(Detection.category) == species_filter.lower())
    if site_ids:
        verified_filters.append(_site_image_condition(site_ids))
        unverified_filters.append(_site_image_condition(site_ids))
        pv_filters.append(_site_image_condition(site_ids))

    # Verified: group by date, sum counts
    verified_query = (
        select(
            func.date(Image.captured_at).label('date'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(func.date(Image.captured_at))
    )

    # Unverified: group by date, count classifications
    unverified_query = (
        select(
            func.date(Image.captured_at).label('date'),
            func.count(Classification.id).label('count')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        .group_by(func.date(Image.captured_at))
    )

    # Person/vehicle: group by date, count detections
    pv_query = (
        select(
            func.date(Image.captured_at).label('date'),
            func.count(Detection.id).label('count')
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *pv_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(func.date(Image.captured_at))
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query, pv_query).subquery()
    final_query = (
        select(
            combined.c.date,
            func.sum(combined.c.count).label('total_count')
        )
        .group_by(combined.c.date)
        .order_by(combined.c.date)
    )

    result = await db.execute(final_query)
    return [{'date': row.date.isoformat(), 'count': int(row.total_count)} for row in result.all()]


async def get_preferred_species_detection_times(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: str,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    site_ids: Optional[List[int]] = None,
) -> List[tuple]:
    """
    Detection times for a single species, preferring human observations
    on verified images and AI on unverified. Returns a list of
    (fractional_hour_in_day, capture_date) tuples ready to feed into the
    von Mises KDE in services/api/utils/activity_analysis.py.

    Person and vehicle Detections are matched on Detection.category when
    species_filter is "person" or "vehicle" (mirrors the dashboard
    convention so the user can pick those as the "species" in the chart
    if they want).
    """
    from shared.models import (
        Image, Camera, Project, Detection, Classification, HumanObservation,
    )

    sp = species_filter.lower()

    # Verified path: HumanObservation matching the species. select_from()
    # is required because Image.captured_at is the only selected column —
    # without it, SQLAlchemy cannot infer that HumanObservation belongs in
    # the FROM clause and the join target is ambiguous.
    verified_query = (
        select(Image.captured_at.label("captured_at"))
        .select_from(HumanObservation)
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.is_verified == True,
                Image.is_hidden == False,
                Camera.project_id.in_(project_ids),
                func.lower(HumanObservation.species) == sp,
            )
        )
    )

    # Unverified path: Classification gated by the project's detection and
    # per-species classification thresholds.
    unverified_query = (
        select(Image.captured_at.label("captured_at"))
        .select_from(Classification)
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Image.is_verified == False,
                Image.is_hidden == False,
                Camera.project_id.in_(project_ids),
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
                func.lower(Classification.species) == sp,
            )
        )
    )

    # Person / vehicle Detections do not produce Classification rows in
    # the current pipeline, so they only flow through this branch.
    pv_query = None
    if sp in ("person", "vehicle"):
        pv_query = (
            select(Image.captured_at.label("captured_at"))
            .select_from(Detection)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                and_(
                    Image.is_verified == False,
                    Image.is_hidden == False,
                    Camera.project_id.in_(project_ids),
                    Detection.confidence >= Project.detection_threshold,
                    func.lower(Detection.category) == sp,
                )
            )
        )

    if start_date is not None:
        verified_query = verified_query.where(Image.captured_at >= start_date)
        unverified_query = unverified_query.where(Image.captured_at >= start_date)
        if pv_query is not None:
            pv_query = pv_query.where(Image.captured_at >= start_date)
    if end_date is not None:
        verified_query = verified_query.where(Image.captured_at <= end_date)
        unverified_query = unverified_query.where(Image.captured_at <= end_date)
        if pv_query is not None:
            pv_query = pv_query.where(Image.captured_at <= end_date)
    if site_ids:
        verified_query = verified_query.where(_site_image_condition(site_ids))
        unverified_query = unverified_query.where(_site_image_condition(site_ids))
        if pv_query is not None:
            pv_query = pv_query.where(_site_image_condition(site_ids))

    union_query = (
        union_all(verified_query, unverified_query, pv_query)
        if pv_query is not None
        else union_all(verified_query, unverified_query)
    )

    result = await db.execute(select(union_query.subquery().c.captured_at))
    rows = result.all()
    out = []
    for r in rows:
        dt: datetime = r.captured_at
        hour = dt.hour + dt.minute / 60.0 + dt.second / 3600.0
        out.append((hour, dt.date()))
    return out


# Naive occupancy = (sites where species detected at least once) / (sites active in window).
# A site is a real Site; an image reaches its site through its deployment.
# "Active" = at least one Deployment overlaps the window. Cameras at one site
# collapse to that single site, so co-located cameras no longer inflate the
# denominator. Independence interval is intentionally NOT applied: presence/
# absence at the (site, window) level is independence-immune. Person and
# vehicle Detections are excluded; HumanObservation rows that happen to use
# 'person' or 'vehicle' as their species string are filtered defensively.
# Images with no resolved site (null deployment) cannot contribute a site and
# are dropped from both numerator and denominator.
_ACTIVE_SITES_CTE = """
WITH active_sites AS (
    SELECT DISTINCT cdp.site_id AS site_id
    FROM deployments cdp
    INNER JOIN cameras c ON cdp.camera_id = c.id
    WHERE c.project_id = ANY(:project_ids)
      AND cdp.site_id IS NOT NULL
      AND (CAST(:site_ids AS integer[]) IS NULL OR cdp.site_id = ANY(CAST(:site_ids AS integer[])))
      AND cdp.start_date <= CAST(:end_date AS date)
      AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:start_date AS date))
)
"""

_NAIVE_OCCUPANCY_SQL = _ACTIVE_SITES_CTE + """,
verified_presence AS (
    SELECT DISTINCT dep.site_id, LOWER(ho.species) AS species
    FROM human_observations ho
    INNER JOIN images i ON ho.image_id = i.id
    INNER JOIN deployments dep ON i.deployment_id = dep.id
    INNER JOIN active_sites asx ON asx.site_id = dep.site_id
    WHERE i.is_verified = TRUE
      AND i.is_hidden = FALSE
      AND i.captured_at >= CAST(:start_dt AS timestamp)
      AND i.captured_at <= CAST(:end_dt AS timestamp)
      AND LOWER(ho.species) NOT IN ('person', 'vehicle')
),
unverified_presence AS (
    SELECT DISTINCT dep.site_id, LOWER(cl.species) AS species
    FROM classifications cl
    INNER JOIN detections d ON cl.detection_id = d.id
    INNER JOIN images i ON d.image_id = i.id
    INNER JOIN deployments dep ON i.deployment_id = dep.id
    INNER JOIN active_sites asx ON asx.site_id = dep.site_id
    INNER JOIN cameras c ON i.camera_id = c.id
    INNER JOIN projects p ON c.project_id = p.id
    WHERE i.is_verified = FALSE
      AND i.is_hidden = FALSE
      AND i.captured_at >= CAST(:start_dt AS timestamp)
      AND i.captured_at <= CAST(:end_dt AS timestamp)
      AND d.confidence >= p.detection_threshold
      AND cl.confidence >= COALESCE(
          (p.classification_thresholds->'overrides'->>cl.species)::float,
          (p.classification_thresholds->>'default')::float,
          0.0
      )
),
all_presence AS (
    SELECT site_id, species FROM verified_presence
    UNION
    SELECT site_id, species FROM unverified_presence
)
SELECT species, COUNT(DISTINCT site_id) AS sites_detected
FROM all_presence
GROUP BY species
ORDER BY sites_detected DESC, species ASC
"""


async def get_naive_occupancy(
    db: AsyncSession,
    project_ids: List[int],
    start_date: datetime,
    end_date: datetime,
    site_ids: Optional[List[int]] = None,
    top_n: Optional[int] = 15,
) -> Tuple[List[dict], int]:
    """
    Return naive occupancy per species and the total active-site count.

    Returns ([{species, sites_detected}, ...], sites_total). Caller computes
    proportion = sites_detected / sites_total. The species list is sorted by
    sites_detected descending and truncated to top_n if given.
    """
    if not project_ids:
        return [], 0

    # Compute the active-site denominator separately so a date window with no
    # detections still surfaces a meaningful sites_total (the chart can render
    # empty bars and the caption still reads correctly).
    sites_total_sql = text(
        _ACTIVE_SITES_CTE + " SELECT COUNT(*) AS sites_total FROM active_sites"
    )
    params = {
        "project_ids": project_ids,
        "site_ids": site_ids,
        "start_date": start_date.date(),
        "end_date": end_date.date(),
        "start_dt": start_date,
        "end_dt": end_date,
    }
    sites_total_row = (await db.execute(sites_total_sql, params)).one()
    sites_total = int(sites_total_row.sites_total)

    presence_rows = (await db.execute(text(_NAIVE_OCCUPANCY_SQL), params)).all()
    points = [
        {"species": row.species, "sites_detected": int(row.sites_detected)}
        for row in presence_rows
    ]
    if top_n is not None:
        points = points[:top_n]
    return points, sites_total


# Detection-history streaming query for the CSV export. Yields one row per
# (camera, occasion, species) triple. `detected` is 1 (any detection that
# occasion), 0 (camera active that occasion with no detection of that species),
# or None when the camera was not active that occasion (mapped to NA in the CSV
# via an empty cell, matching unmarked / camtrapR conventions).
# Site x occasion detection grid for the single-season occupancy fitter.
# One matrix row per active site (not per camera): cameras at the same site
# collapse to one survey unit, matching the naive-occupancy denominator.
_SITE_MATRIX_ACTIVE_SQL = """
WITH occ AS (
    SELECT gs AS occ_idx,
           CAST(:start_date AS date) + (gs * :occasion_length) AS occ_start,
           CAST(:start_date AS date) + (gs * :occasion_length) + (:occasion_length - 1) AS occ_end
    FROM generate_series(0, :n_occ - 1) gs
)
SELECT DISTINCT cdp.site_id, occ.occ_idx
FROM deployments cdp
INNER JOIN cameras c ON cdp.camera_id = c.id
INNER JOIN occ ON cdp.start_date <= occ.occ_end
             AND (cdp.end_date IS NULL OR cdp.end_date >= occ.occ_start)
WHERE c.project_id = ANY(:project_ids)
  AND cdp.site_id IS NOT NULL
  AND (CAST(:site_ids AS integer[]) IS NULL OR cdp.site_id = ANY(CAST(:site_ids AS integer[])))
"""

_SITE_MATRIX_DETECTED_SQL = """
SELECT DISTINCT dep.site_id,
       FLOOR((DATE_TRUNC('day', ts)::date - CAST(:start_date AS date)) / :occasion_length)::int AS occ_idx,
       species
FROM (
    SELECT i.deployment_id, i.captured_at AS ts, LOWER(ho.species) AS species
    FROM human_observations ho
    INNER JOIN images i ON ho.image_id = i.id
    WHERE i.is_verified = TRUE AND i.is_hidden = FALSE
      AND i.captured_at >= CAST(:start_dt AS timestamp)
      AND i.captured_at <= CAST(:end_dt AS timestamp)
      AND LOWER(ho.species) NOT IN ('person', 'vehicle')
    UNION ALL
    SELECT i.deployment_id, i.captured_at AS ts, LOWER(cl.species) AS species
    FROM classifications cl
    INNER JOIN detections d ON cl.detection_id = d.id
    INNER JOIN images i ON d.image_id = i.id
    INNER JOIN cameras c ON i.camera_id = c.id
    INNER JOIN projects p ON c.project_id = p.id
    WHERE i.is_verified = FALSE AND i.is_hidden = FALSE
      AND i.captured_at >= CAST(:start_dt AS timestamp)
      AND i.captured_at <= CAST(:end_dt AS timestamp)
      AND d.confidence >= p.detection_threshold
      AND cl.confidence >= COALESCE(
          (p.classification_thresholds->'overrides'->>cl.species)::float,
          (p.classification_thresholds->>'default')::float,
          0.0
      )
) obs
INNER JOIN deployments dep ON obs.deployment_id = dep.id
WHERE dep.site_id IS NOT NULL
  AND (CAST(:species_list AS text[]) IS NULL OR species = ANY(:species_list))
"""


def _occasions(start_date: date, end_date: date, occasion_length_days: int) -> List[Tuple[int, date, date]]:
    """Occasion windows as (index, occ_start, occ_end), clamped to end_date."""
    out: List[Tuple[int, date, date]] = []
    n_occ = ((end_date - start_date).days // occasion_length_days) + 1
    for idx in range(n_occ):
        occ_start = start_date + timedelta(days=idx * occasion_length_days)
        occ_end = min(occ_start + timedelta(days=occasion_length_days - 1), end_date)
        out.append((idx, occ_start, occ_end))
    return out


async def build_site_detection_history(
    db: AsyncSession,
    project_ids: List[int],
    start_date: date,
    end_date: date,
    site_ids: Optional[List[int]] = None,
    species_subset: Optional[List[str]] = None,
    occasion_length_days: int = 7,
) -> dict:
    """Site x occasion detection history, the shape occupancy models in R expect.

    A "site" is the survey station (a real Site, not the physical camera), so
    cameras at one place pool into one row and a camera swap stays the same row,
    matching camtrapR's station concept. Returns:

        {
            "site_ids":  [ordered active site ids],
            "site_names": {site_id: name},
            "occasions": [(idx, occ_start, occ_end), ...],
            "matrices":  {species: [[cell, ...one per occasion...], ...one row per site...]},
        }

    Each cell is 1 (detected that occasion), 0 (site active, no detection), or
    None (site inactive, mapped to NA / empty). `species_subset` None means every
    observed species in the window.
    """
    if not project_ids:
        return {"site_ids": [], "site_names": {}, "occasions": [], "matrices": {}}

    occasions = _occasions(start_date, end_date, occasion_length_days)
    n_occ = len(occasions)
    species_lower = sorted({s.lower() for s in species_subset}) if species_subset is not None else None
    params = {
        "project_ids": project_ids,
        "site_ids": site_ids,
        "start_date": start_date,
        "end_dt": datetime.combine(end_date, datetime.max.time()),
        "start_dt": datetime.combine(start_date, datetime.min.time()),
        "occasion_length": occasion_length_days,
        "n_occ": n_occ,
        "species_list": species_lower,
    }

    active_rows = (await db.execute(text(_SITE_MATRIX_ACTIVE_SQL), params)).all()
    active: set[Tuple[int, int]] = {(r.site_id, r.occ_idx) for r in active_rows}
    if not active:
        return {"site_ids": [], "site_names": {}, "occasions": occasions, "matrices": {}}

    detected_rows = (await db.execute(text(_SITE_MATRIX_DETECTED_SQL), params)).all()
    detected: Dict[str, set[Tuple[int, int]]] = {}
    for r in detected_rows:
        detected.setdefault(r.species, set()).add((r.site_id, r.occ_idx))

    sorted_sites = sorted({s for s, _ in active})
    name_rows = (await db.execute(
        text("SELECT id, name FROM sites WHERE id = ANY(:ids)"),
        {"ids": sorted_sites},
    )).all()
    site_names = {row.id: row.name for row in name_rows}

    # When no species filter was given, report every observed species.
    species_out = species_subset if species_subset is not None else sorted(detected.keys())

    matrices: Dict[str, List[List[Optional[int]]]] = {}
    for sp_label in species_out:
        det = detected.get(sp_label.lower(), set())
        matrix: List[List[Optional[int]]] = []
        for site_id in sorted_sites:
            history: List[Optional[int]] = []
            for occ in range(n_occ):
                if (site_id, occ) in det:
                    history.append(1)
                elif (site_id, occ) in active:
                    history.append(0)
                else:
                    history.append(None)
            matrix.append(history)
        matrices[sp_label] = matrix

    return {
        "site_ids": sorted_sites,
        "site_names": site_names,
        "occasions": occasions,
        "matrices": matrices,
    }


async def build_site_detection_matrix(
    db: AsyncSession,
    project_ids: List[int],
    start_date: date,
    end_date: date,
    species_subset: List[str],
    site_ids: Optional[List[int]] = None,
    occasion_length_days: int = 7,
) -> Dict[str, List[List[Optional[int]]]]:
    """Site x occasion detection matrix per species (rows in site-id order).

    Thin wrapper over build_site_detection_history for the occupancy fitter,
    which only needs the per-species matrices.
    """
    if not species_subset:
        return {}
    history = await build_site_detection_history(
        db, project_ids, start_date, end_date,
        site_ids=site_ids, species_subset=species_subset,
        occasion_length_days=occasion_length_days,
    )
    return history["matrices"]
