"""
Utility functions for querying species counts with human verification preference.

When an image is verified, uses HumanObservation data.
When not verified, falls back to AI Detection/Classification data.
"""
from typing import AsyncGenerator, Dict, List, Optional, Tuple
from datetime import date, datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, union_all, literal, text

from shared.classification_threshold import classification_passes_threshold


async def get_preferred_species_counts(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
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
    if camera_ids:
        pv_filters.append(Image.camera_id.in_(camera_ids))

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
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
        pv_filters.append(Image.camera_id.in_(camera_ids))

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
    camera_ids: Optional[List[int]] = None,
) -> int:
    """
    Get total unique species count from preferred data source.
    """
    species_list = await get_preferred_unique_species(db, project_ids, camera_ids=camera_ids)
    return len(species_list)


async def get_preferred_hourly_activity(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
        pv_filters.append(Image.camera_id.in_(camera_ids))

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
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
        pv_filters.append(Image.camera_id.in_(camera_ids))

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


async def get_preferred_species_camera_matrix(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    camera_ids: Optional[List[int]] = None,
) -> List[dict]:
    """
    Get species counts per camera from preferred data source.

    For verified images: uses HumanObservation
    For unverified: uses Classification

    Returns list of {camera_name: str, species: str, count: int}.
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
        pv_filters.append(Image.camera_id.in_(camera_ids))

    # Verified: group by camera and species, sum counts
    verified_query = (
        select(
            Camera.name.label('camera_name'),
            HumanObservation.species.label('species'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(Camera.name, HumanObservation.species)
    )

    # Unverified: group by camera and species, count classifications
    unverified_query = (
        select(
            Camera.name.label('camera_name'),
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
        .group_by(Camera.name, Classification.species)
    )

    # Person/vehicle: group by camera and detection category
    pv_query = (
        select(
            Camera.name.label('camera_name'),
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
        .group_by(Camera.name, Detection.category)
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query, pv_query).subquery()
    final_query = (
        select(
            combined.c.camera_name,
            combined.c.species,
            func.sum(combined.c.count).label('total_count')
        )
        .group_by(combined.c.camera_name, combined.c.species)
    )

    result = await db.execute(final_query)
    return [
        {'camera_name': row.camera_name, 'species': row.species, 'count': int(row.total_count)}
        for row in result.all()
    ]


async def get_preferred_daily_trend(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_filters.append(Image.camera_id.in_(camera_ids))
        unverified_filters.append(Image.camera_id.in_(camera_ids))
        pv_filters.append(Image.camera_id.in_(camera_ids))

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
    camera_ids: Optional[List[int]] = None,
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
    if camera_ids:
        verified_query = verified_query.where(Image.camera_id.in_(camera_ids))
        unverified_query = unverified_query.where(Image.camera_id.in_(camera_ids))
        if pv_query is not None:
            pv_query = pv_query.where(Image.camera_id.in_(camera_ids))

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
# Site = Camera. "Active" = at least one CameraDeploymentPeriod overlaps the window.
# Independence interval is intentionally NOT applied: presence/absence at the
# (site, window) level is independence-immune. Person and vehicle Detections
# are excluded; HumanObservation rows that happen to use 'person' or 'vehicle'
# as their species string are filtered defensively.
_NAIVE_OCCUPANCY_SQL = """
WITH active_cameras AS (
    SELECT DISTINCT c.id AS camera_id
    FROM cameras c
    INNER JOIN camera_deployment_periods cdp ON cdp.camera_id = c.id
    WHERE c.project_id = ANY(:project_ids)
      AND (CAST(:camera_ids AS integer[]) IS NULL OR c.id = ANY(CAST(:camera_ids AS integer[])))
      AND cdp.start_date <= CAST(:end_date AS date)
      AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:start_date AS date))
),
verified_presence AS (
    SELECT DISTINCT i.camera_id, LOWER(ho.species) AS species
    FROM human_observations ho
    INNER JOIN images i ON ho.image_id = i.id
    INNER JOIN active_cameras ac ON ac.camera_id = i.camera_id
    WHERE i.is_verified = TRUE
      AND i.is_hidden = FALSE
      AND i.captured_at >= CAST(:start_dt AS timestamp)
      AND i.captured_at <= CAST(:end_dt AS timestamp)
      AND LOWER(ho.species) NOT IN ('person', 'vehicle')
),
unverified_presence AS (
    SELECT DISTINCT i.camera_id, LOWER(cl.species) AS species
    FROM classifications cl
    INNER JOIN detections d ON cl.detection_id = d.id
    INNER JOIN images i ON d.image_id = i.id
    INNER JOIN active_cameras ac ON ac.camera_id = i.camera_id
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
    SELECT camera_id, species FROM verified_presence
    UNION
    SELECT camera_id, species FROM unverified_presence
)
SELECT species, COUNT(DISTINCT camera_id) AS sites_detected
FROM all_presence
GROUP BY species
ORDER BY sites_detected DESC, species ASC
"""


async def get_naive_occupancy(
    db: AsyncSession,
    project_ids: List[int],
    start_date: datetime,
    end_date: datetime,
    camera_ids: Optional[List[int]] = None,
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
    sites_total_sql = text("""
        SELECT COUNT(DISTINCT c.id) AS sites_total
        FROM cameras c
        INNER JOIN camera_deployment_periods cdp ON cdp.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:camera_ids AS integer[]) IS NULL OR c.id = ANY(CAST(:camera_ids AS integer[])))
          AND cdp.start_date <= CAST(:end_date AS date)
          AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:start_date AS date))
    """)
    params = {
        "project_ids": project_ids,
        "camera_ids": camera_ids,
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
async def build_detection_matrix(
    db: AsyncSession,
    project_ids: List[int],
    start_date: date,
    end_date: date,
    species_subset: List[str],
    camera_ids: Optional[List[int]] = None,
    occasion_length_days: int = 7,
) -> Dict[str, List[List[Optional[int]]]]:
    """In-memory site x occasion detection matrix per species.

    Same data shape `get_detection_history` streams to CSV, but
    grouped by species and materialised so a server-side occupancy
    fitter can iterate over it. Returns
    `{species: [[per_occasion, ...], ...one row per active camera...]}`
    where each cell is `1` (detected), `0` (active, no detection), or
    `None` (camera inactive that occasion).

    `species_subset` filters which species appear in the result; pass
    the species the caller actually intends to fit. The streaming
    generator already emits dense cells for every camera x occasion x
    project-species combination, so the matrix is exact when the
    caller's subset is contained in the project's observed species.
    """
    species_lower = {s.lower() for s in species_subset}
    if not species_lower:
        return {}

    # (camera_id, occasion_num) -> species -> detected
    grid: Dict[Tuple[str, int], Dict[str, Optional[int]]] = {}
    cameras_seen: set[str] = set()
    occasions_seen: set[int] = set()
    async for row in get_detection_history(
        db=db,
        project_ids=project_ids,
        start_date=start_date,
        end_date=end_date,
        camera_ids=camera_ids,
        occasion_length_days=occasion_length_days,
    ):
        sp = row["species"]
        if sp not in species_lower:
            continue
        key = (row["locationID"], row["occasion"])
        cameras_seen.add(row["locationID"])
        occasions_seen.add(row["occasion"])
        grid.setdefault(key, {})[sp] = row["detected"]

    sorted_cams = sorted(cameras_seen, key=lambda s: int(s) if s.isdigit() else s)
    sorted_occs = sorted(occasions_seen)

    out: Dict[str, List[List[Optional[int]]]] = {}
    for sp_label in species_subset:
        sp = sp_label.lower()
        matrix: List[List[Optional[int]]] = []
        for cam in sorted_cams:
            history: List[Optional[int]] = []
            for occ in sorted_occs:
                history.append(grid.get((cam, occ), {}).get(sp))
            matrix.append(history)
        out[sp_label] = matrix
    return out


async def get_detection_history(
    db: AsyncSession,
    project_ids: List[int],
    start_date: date,
    end_date: date,
    camera_ids: Optional[List[int]] = None,
    occasion_length_days: int = 1,
) -> AsyncGenerator[dict, None]:
    """
    Yield detection-history rows for the CSV export.

    Order: (camera_id, occasion, species). Uses one round-trip per slice of
    species-set so memory stays bounded even on large projects.
    """
    if occasion_length_days < 1 or occasion_length_days > 30:
        raise ValueError("occasion_length_days must be 1..30")
    if start_date > end_date:
        raise ValueError("start_date must be <= end_date")
    if not project_ids:
        return

    # Active cameras + bounding deployment dates per camera. `Camera.location`
    # is unused in this codebase; per-occasion GPS is read from the matching
    # CameraDeploymentPeriod below so a moved camera reports the correct
    # coordinates for each occasion.
    cameras_sql = text("""
        SELECT
            c.id AS camera_id,
            c.name AS camera_name,
            MIN(cdp.start_date) AS first_start,
            MAX(COALESCE(cdp.end_date, CURRENT_DATE)) AS last_end
        FROM cameras c
        INNER JOIN camera_deployment_periods cdp ON cdp.camera_id = c.id
        WHERE c.project_id = ANY(:project_ids)
          AND (CAST(:camera_ids AS integer[]) IS NULL OR c.id = ANY(CAST(:camera_ids AS integer[])))
          AND cdp.start_date <= CAST(:end_date AS date)
          AND (cdp.end_date IS NULL OR cdp.end_date >= CAST(:start_date AS date))
        GROUP BY c.id, c.name
        ORDER BY c.id
    """)
    cameras = (await db.execute(cameras_sql, {
        "project_ids": project_ids,
        "camera_ids": camera_ids,
        "start_date": start_date,
        "end_date": end_date,
    })).all()
    if not cameras:
        return
    active_camera_ids = [c.camera_id for c in cameras]

    # Deployment intervals per camera with their per-deployment GPS so we
    # can stamp each (camera, occasion) row with the location the camera
    # was actually at during that occasion. A camera can have several rows
    # here when it was moved more than 100 m mid-window.
    deployments_sql = text("""
        SELECT camera_id, start_date AS dep_start,
               COALESCE(end_date, CURRENT_DATE) AS dep_end,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lon
        FROM camera_deployment_periods
        WHERE camera_id = ANY(:camera_ids)
          AND start_date <= CAST(:end_date AS date)
          AND (end_date IS NULL OR end_date >= CAST(:start_date AS date))
        ORDER BY camera_id, start_date
    """)
    dep_rows = (await db.execute(deployments_sql, {
        "camera_ids": active_camera_ids,
        "start_date": start_date,
        "end_date": end_date,
    })).all()
    deployments_by_camera: dict = {}
    for r in dep_rows:
        # Treat POINT(0 0) as missing — the backfill script writes that as a
        # placeholder when a deployment has no usable GPS.
        lat = r.lat if r.lat is not None and (r.lat != 0 or r.lon != 0) else None
        lon = r.lon if lat is not None else None
        deployments_by_camera.setdefault(r.camera_id, []).append(
            (r.dep_start, r.dep_end, lat, lon)
        )

    # All species observed at any active camera during the window.
    species_sql = text("""
        SELECT DISTINCT species FROM (
            SELECT LOWER(ho.species) AS species
            FROM human_observations ho
            INNER JOIN images i ON ho.image_id = i.id
            WHERE i.camera_id = ANY(:camera_ids)
              AND i.is_verified = TRUE AND i.is_hidden = FALSE
              AND i.captured_at >= CAST(:start_dt AS timestamp)
              AND i.captured_at <= CAST(:end_dt AS timestamp)
              AND LOWER(ho.species) NOT IN ('person', 'vehicle')
            UNION
            SELECT LOWER(cl.species) AS species
            FROM classifications cl
            INNER JOIN detections d ON cl.detection_id = d.id
            INNER JOIN images i ON d.image_id = i.id
            INNER JOIN cameras c ON i.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            WHERE i.camera_id = ANY(:camera_ids)
              AND i.is_verified = FALSE AND i.is_hidden = FALSE
              AND i.captured_at >= CAST(:start_dt AS timestamp)
              AND i.captured_at <= CAST(:end_dt AS timestamp)
              AND d.confidence >= p.detection_threshold
              AND cl.confidence >= COALESCE(
                  (p.classification_thresholds->'overrides'->>cl.species)::float,
                  (p.classification_thresholds->>'default')::float,
                  0.0
              )
        ) s
        WHERE species IS NOT NULL AND species <> ''
        ORDER BY species
    """)
    start_dt = datetime.combine(start_date, datetime.min.time())
    end_dt = datetime.combine(end_date, datetime.max.time())
    species_rows = (await db.execute(species_sql, {
        "camera_ids": active_camera_ids,
        "start_dt": start_dt,
        "end_dt": end_dt,
    })).all()
    species_list = [r.species for r in species_rows]
    if not species_list:
        # No species observed; still emit zero-rows per (camera, occasion) so
        # downstream code can verify the active-camera × occasion grid.
        species_list = []

    # All presence pairs (camera, occasion_start, species) in one fetch — the
    # observed cells. Anything not present is either 0 (camera active) or NA
    # (camera not active), determined by the deployment-overlap test below.
    presence_sql = text("""
        SELECT camera_id, occasion_start, species FROM (
            SELECT
                i.camera_id AS camera_id,
                (DATE_TRUNC('day', i.captured_at)::date
                 - ((EXTRACT(EPOCH FROM (DATE_TRUNC('day', i.captured_at) - CAST(:start_date AS timestamp)))::bigint
                     / 86400) % :occasion_length) * INTERVAL '1 day'
                )::date AS occasion_start,
                LOWER(ho.species) AS species
            FROM human_observations ho
            INNER JOIN images i ON ho.image_id = i.id
            WHERE i.camera_id = ANY(:camera_ids)
              AND i.is_verified = TRUE AND i.is_hidden = FALSE
              AND i.captured_at >= CAST(:start_dt AS timestamp)
              AND i.captured_at <= CAST(:end_dt AS timestamp)
              AND LOWER(ho.species) NOT IN ('person', 'vehicle')
            UNION
            SELECT
                i.camera_id AS camera_id,
                (DATE_TRUNC('day', i.captured_at)::date
                 - ((EXTRACT(EPOCH FROM (DATE_TRUNC('day', i.captured_at) - CAST(:start_date AS timestamp)))::bigint
                     / 86400) % :occasion_length) * INTERVAL '1 day'
                )::date AS occasion_start,
                LOWER(cl.species) AS species
            FROM classifications cl
            INNER JOIN detections d ON cl.detection_id = d.id
            INNER JOIN images i ON d.image_id = i.id
            INNER JOIN cameras c ON i.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            WHERE i.camera_id = ANY(:camera_ids)
              AND i.is_verified = FALSE AND i.is_hidden = FALSE
              AND i.captured_at >= CAST(:start_dt AS timestamp)
              AND i.captured_at <= CAST(:end_dt AS timestamp)
              AND d.confidence >= p.detection_threshold
              AND cl.confidence >= COALESCE(
                  (p.classification_thresholds->'overrides'->>cl.species)::float,
                  (p.classification_thresholds->>'default')::float,
                  0.0
              )
        ) p
        GROUP BY camera_id, occasion_start, species
    """)
    presence_rows = (await db.execute(presence_sql, {
        "camera_ids": active_camera_ids,
        "start_date": start_date,
        "occasion_length": occasion_length_days,
        "start_dt": start_dt,
        "end_dt": end_dt,
    })).all()
    presence_set = {(r.camera_id, r.occasion_start, r.species) for r in presence_rows}

    # Walk the full grid in deterministic order: camera, occasion, species.
    occasions: List[Tuple[int, date, date]] = []
    occ_idx = 1
    cursor = start_date
    while cursor <= end_date:
        occ_end = min(cursor + timedelta(days=occasion_length_days - 1), end_date)
        occasions.append((occ_idx, cursor, occ_end))
        cursor = occ_end + timedelta(days=1)
        occ_idx += 1

    for cam in cameras:
        deps = deployments_by_camera.get(cam.camera_id, [])
        for occ_num, occ_start, occ_end in occasions:
            # Find the deployment that covers this occasion. Pick the first
            # overlapping deployment with valid GPS so a moved camera reports
            # the correct location per occasion. Fall back to any overlapping
            # deployment when none has GPS — the camera is still "active".
            matching: Optional[Tuple[date, date, Optional[float], Optional[float]]] = None
            fallback_active: Optional[Tuple[date, date, Optional[float], Optional[float]]] = None
            for d in deps:
                d_start, d_end, _, _ = d
                if d_start <= occ_end and d_end >= occ_start:
                    fallback_active = fallback_active or d
                    if d[2] is not None:
                        matching = d
                        break
            chosen = matching or fallback_active
            active = chosen is not None
            lat = chosen[2] if chosen else None
            lon = chosen[3] if chosen else None
            for sp in species_list:
                if not active:
                    detected: Optional[int] = None
                elif (cam.camera_id, occ_start, sp) in presence_set:
                    detected = 1
                else:
                    detected = 0
                yield {
                    "locationID": str(cam.camera_id),
                    "locationName": cam.camera_name,
                    "latitude": round(lat, 6) if lat is not None else None,
                    "longitude": round(lon, 6) if lon is not None else None,
                    "occasion": occ_num,
                    "occasion_start": occ_start.isoformat(),
                    "occasion_end": occ_end.isoformat(),
                    "species": sp,
                    "detected": detected,
                }
