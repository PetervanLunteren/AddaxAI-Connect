"""
Utility functions for querying species counts with human verification preference.

When an image is verified, uses HumanObservation data.
When not verified, falls back to AI Detection/Classification data.
"""
from typing import List, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, union_all, literal


async def get_preferred_species_counts(
    db: AsyncSession,
    project_ids: List[int],
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    camera_id: Optional[int] = None,
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
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)
    if camera_id:
        verified_filters.append(Image.camera_id == camera_id)
        unverified_filters.append(Image.camera_id == camera_id)
    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())

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
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Classification.species)
    )

    # Combine with UNION ALL and sum again to merge same species from both sources
    combined = union_all(verified_query, unverified_query).subquery()

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

    if start_date:
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)

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
                Detection.confidence >= Project.detection_threshold
            )
        )
        .distinct()
    )

    # Combine and get unique
    combined = union_all(verified_species, unverified_species).subquery()
    final_query = select(combined.c.species).distinct().order_by(combined.c.species)

    result = await db.execute(final_query)
    return [row.species for row in result.all()]


async def get_preferred_total_species_count(
    db: AsyncSession,
    project_ids: List[int],
) -> int:
    """
    Get total unique species count from preferred data source.
    """
    species_list = await get_preferred_unique_species(db, project_ids)
    return len(species_list)


async def get_preferred_hourly_activity(
    db: AsyncSession,
    project_ids: List[int],
    species_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> List[dict]:
    """
    Get hourly activity counts (0-23) from preferred data source.

    Uses image upload time for hour extraction.
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

    if start_date:
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)
    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())

    # Verified: group by hour, sum counts from HumanObservation
    verified_query = (
        select(
            func.extract('hour', Image.uploaded_at).label('hour'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(func.extract('hour', Image.uploaded_at))
    )

    # Unverified: group by hour, count classifications
    unverified_query = (
        select(
            func.extract('hour', Image.uploaded_at).label('hour'),
            func.count(Classification.id).label('count')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(func.extract('hour', Image.uploaded_at))
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query).subquery()
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

    if start_date:
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)

    # Verified: first date from human observations
    verified_query = (
        select(
            HumanObservation.species.label('species'),
            func.min(func.date(Image.uploaded_at)).label('first_date')
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
            func.min(func.date(Image.uploaded_at)).label('first_date')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Classification.species)
    )

    # Combine and get min date per species (earliest across both sources)
    combined = union_all(verified_query, unverified_query).subquery()
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

    if start_date:
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)

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
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Camera.name, Classification.species)
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query).subquery()
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

    if start_date:
        verified_filters.append(Image.uploaded_at >= start_date)
        unverified_filters.append(Image.uploaded_at >= start_date)
    if end_date:
        verified_filters.append(Image.uploaded_at <= end_date)
        unverified_filters.append(Image.uploaded_at <= end_date)
    if species_filter:
        verified_filters.append(func.lower(HumanObservation.species) == species_filter.lower())
        unverified_filters.append(func.lower(Classification.species) == species_filter.lower())

    # Verified: group by date, sum counts
    verified_query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.sum(HumanObservation.count).label('count')
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*verified_filters))
        .group_by(func.date(Image.uploaded_at))
    )

    # Unverified: group by date, count classifications
    unverified_query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Classification.id).label('count')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                *unverified_filters,
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(func.date(Image.uploaded_at))
    )

    # Combine and sum
    combined = union_all(verified_query, unverified_query).subquery()
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
