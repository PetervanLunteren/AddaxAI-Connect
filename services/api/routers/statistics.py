"""
Statistics endpoints for dashboard metrics and charts.
"""
from typing import List, Optional, Any, Dict
from datetime import date, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc, text
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification, Project
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids


router = APIRouter(prefix="/api/statistics", tags=["statistics"])


class StatisticsOverview(BaseModel):
    """Dashboard overview statistics"""
    total_images: int
    total_cameras: int
    total_species: int
    images_today: int


class TimelineDataPoint(BaseModel):
    """Data point for timeline chart"""
    date: str  # YYYY-MM-DD
    count: int


class SpeciesCount(BaseModel):
    """Species distribution data"""
    species: str
    count: int


class CameraActivitySummary(BaseModel):
    """Camera activity status counts"""
    active: int
    inactive: int
    never_reported: int


class LastUpdateResponse(BaseModel):
    """Last update timestamp"""
    last_update: str | None  # ISO timestamp or null


@router.get(
    "/overview",
    response_model=StatisticsOverview,
)
async def get_overview(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get dashboard overview statistics (filtered by accessible projects)

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Overview statistics for dashboard
    """
    # Total images (filtered by project via camera)
    total_images_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(Camera.project_id.in_(accessible_project_ids))
    )
    total_images = total_images_result.scalar_one()

    # Total cameras (filtered by project)
    total_cameras_result = await db.execute(
        select(func.count(Camera.id))
        .where(Camera.project_id.in_(accessible_project_ids))
    )
    total_cameras = total_cameras_result.scalar_one()

    # Total unique species (filtered by project and detection threshold)
    total_species_result = await db.execute(
        select(func.count(func.distinct(Classification.species)))
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
    )
    total_species = total_species_result.scalar_one()

    # Images today (filtered by project)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    images_today_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Image.uploaded_at >= today_start,
                Camera.project_id.in_(accessible_project_ids)
            )
        )
    )
    images_today = images_today_result.scalar_one()

    return StatisticsOverview(
        total_images=total_images,
        total_cameras=total_cameras,
        total_species=total_species,
        images_today=images_today,
    )


@router.get(
    "/images-timeline",
    response_model=List[TimelineDataPoint],
)
async def get_images_timeline(
    days: Optional[int] = Query(None, description="Number of days to look back (default: 30, use 0 for all time)"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get images uploaded over time (filtered by accessible projects)

    Args:
        days: Number of days to look back (None/30 = last 30 days, 0 = all time)
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of data points with date and count
    """
    # Calculate date range
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    num_days = days if days is not None else 30
    start_date = end_date - timedelta(days=num_days) if num_days > 0 else None

    # Query images grouped by date (filtered by project via camera)
    conditions = [Camera.project_id.in_(accessible_project_ids)]
    if start_date is not None:
        conditions.append(Image.uploaded_at >= start_date)

    query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Image.id).label('count')
        )
        .join(Camera)
        .where(and_(*conditions))
        .group_by(func.date(Image.uploaded_at))
        .order_by(func.date(Image.uploaded_at))
    )

    result = await db.execute(query)
    rows = result.all()

    # Convert to response format
    data_points = []
    for row in rows:
        data_points.append(TimelineDataPoint(
            date=row.date.isoformat(),
            count=row.count,
        ))

    return data_points


@router.get(
    "/species-distribution",
    response_model=List[SpeciesCount],
)
async def get_species_distribution(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species distribution (top 10, filtered by accessible projects and detection threshold)

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of species with counts (top 10 by count, only from detections above threshold)
    """
    query = (
        select(
            Classification.species,
            func.count(Classification.id).label('count')
        )
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Classification.species)
        .order_by(desc('count'))
        .limit(10)
    )

    result = await db.execute(query)
    rows = result.all()

    species_counts = []
    for row in rows:
        species_counts.append(SpeciesCount(
            species=row.species,
            count=row.count,
        ))

    return species_counts


@router.get(
    "/camera-activity",
    response_model=CameraActivitySummary,
)
async def get_camera_activity(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get camera activity status summary (filtered by accessible projects)

    Categorizes cameras as:
    - Active: Last report within 7 days
    - Inactive: Last report older than 7 days
    - Never Reported: No health report received

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Camera activity counts by status
    """
    # Fetch cameras filtered by accessible projects
    result = await db.execute(
        select(Camera).where(Camera.project_id.in_(accessible_project_ids))
    )
    cameras = result.scalars().all()

    active_count = 0
    inactive_count = 0
    never_reported_count = 0

    cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)

    for camera in cameras:
        # Check if has health report
        if not camera.config or 'last_report_timestamp' not in camera.config:
            never_reported_count += 1
            continue

        last_report_str = camera.config.get('last_report_timestamp')
        if not last_report_str:
            never_reported_count += 1
            continue

        try:
            last_report = datetime.fromisoformat(last_report_str)
            if last_report >= cutoff_date:
                active_count += 1
            else:
                inactive_count += 1
        except (ValueError, TypeError):
            never_reported_count += 1

    return CameraActivitySummary(
        active=active_count,
        inactive=inactive_count,
        never_reported=never_reported_count,
    )


@router.get(
    "/last-update",
    response_model=LastUpdateResponse,
)
async def get_last_update(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get timestamp of most recently classified image (filtered by accessible projects)

    Returns EXIF DateTimeOriginal (actual capture time) if available, falls back to uploaded_at

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Last update timestamp (EXIF capture time preferred) or null if no images exist
    """
    # Query most recent classified image (filtered by project via camera)
    query = (
        select(Image)
        .join(Camera)
        .where(
            and_(
                Image.status == "classified",
                Camera.project_id.in_(accessible_project_ids)
            )
        )
        .order_by(desc(Image.uploaded_at))
        .limit(1)
    )

    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        return LastUpdateResponse(last_update=None)

    # Prefer EXIF DateTimeOriginal (actual capture time) over uploaded_at
    last_update_str = None
    if image.image_metadata and 'DateTimeOriginal' in image.image_metadata:
        last_update_str = image.image_metadata['DateTimeOriginal']
    else:
        last_update_str = image.uploaded_at.isoformat()

    return LastUpdateResponse(last_update=last_update_str)


class DeploymentFeatureProperties(BaseModel):
    """Properties for a single deployment feature in GeoJSON"""
    camera_id: int
    camera_name: str
    deployment_id: int
    start_date: str  # YYYY-MM-DD
    end_date: Optional[str]  # YYYY-MM-DD or null for active deployments
    trap_days: int
    detection_count: int
    detection_rate: float  # detections per trap-day
    detection_rate_per_100: float  # detections per 100 trap-days (for display)


class DeploymentFeatureGeometry(BaseModel):
    """GeoJSON geometry for point feature"""
    type: str = "Point"
    coordinates: List[float]  # [longitude, latitude]


class DeploymentFeature(BaseModel):
    """Single deployment feature in GeoJSON format"""
    type: str = "Feature"
    id: str  # camera_id-deployment_id (e.g., "23-2")
    geometry: DeploymentFeatureGeometry
    properties: DeploymentFeatureProperties


class DetectionRateMapResponse(BaseModel):
    """GeoJSON FeatureCollection for detection rate map"""
    type: str = "FeatureCollection"
    features: List[DeploymentFeature]


@router.get(
    "/detection-rate-map",
    response_model=DetectionRateMapResponse,
)
async def get_detection_rate_map(
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter detections from this date (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="Filter detections to this date (YYYY-MM-DD)"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get detection rate map data as GeoJSON.

    Returns camera deployment locations with detection rates (detections per trap-day).
    Each deployment period appears as a separate point on the map.

    Filtering:
    - Automatically filtered by user's accessible projects
    - Optional species filter (exact match, case-insensitive)
    - Optional date range filter (applies to detection dates)
    - Respects project detection thresholds

    Detection rate calculation:
    - detections = count of detections in deployment period (optionally filtered by species/dates)
    - trap_days = end_date - start_date + 1 (or today - start_date + 1 for active deployments)
    - detection_rate = detections / trap_days
    - Shows 0.0 for deployments with no detections

    Args:
        species: Filter by species name (optional, case-insensitive)
        start_date: Filter detections from date (optional, YYYY-MM-DD)
        end_date: Filter detections to date (optional, YYYY-MM-DD)
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        GeoJSON FeatureCollection with deployment features
    """
    # Build SQL query with conditional filters
    # Use LEFT JOIN to include deployments with zero detections
    query_sql = """
        WITH deployment_detections AS (
            SELECT
                cdp.id as deployment_id,
                cdp.camera_id,
                cdp.deployment_id as deployment_number,
                cdp.start_date,
                cdp.end_date,
                ST_X(cdp.location::geometry) as lon,
                ST_Y(cdp.location::geometry) as lat,
                -- Calculate trap days
                COALESCE(
                    (cdp.end_date - cdp.start_date + 1),
                    (CURRENT_DATE - cdp.start_date + 1)
                ) as trap_days,
                -- Count detections (filtered by species/date if specified)
                COUNT(d.id) FILTER (WHERE
                    d.id IS NOT NULL
                    AND d.confidence >= p.detection_threshold
                    AND (CAST(:species AS text) IS NULL OR LOWER(cl.species) = LOWER(CAST(:species AS text)))
                    AND (CAST(:start_date AS date) IS NULL OR i.uploaded_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.uploaded_at::date <= CAST(:end_date AS date))
                ) as detection_count,
                c.name as camera_name
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.uploaded_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.uploaded_at::date <= cdp.end_date)
            LEFT JOIN detections d ON d.image_id = i.id
            LEFT JOIN classifications cl ON cl.detection_id = d.id
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY
                cdp.id,
                cdp.camera_id,
                cdp.deployment_id,
                cdp.start_date,
                cdp.end_date,
                cdp.location,
                c.name,
                p.detection_threshold
        )
        SELECT
            camera_id,
            camera_name,
            deployment_number,
            start_date,
            end_date,
            lon,
            lat,
            trap_days,
            detection_count,
            CASE
                WHEN trap_days > 0 THEN detection_count::float / trap_days
                ELSE 0.0
            END as detection_rate,
            CASE
                WHEN trap_days > 0 THEN (detection_count::float / trap_days) * 100
                ELSE 0.0
            END as detection_rate_per_100
        FROM deployment_detections
        ORDER BY camera_id, deployment_number
    """

    # Execute query
    result = await db.execute(
        text(query_sql),
        {
            "species": species,
            "start_date": start_date,
            "end_date": end_date,
            "project_ids": accessible_project_ids,
        }
    )
    rows = result.fetchall()

    # Convert to GeoJSON features
    features = []
    for row in rows:
        feature = DeploymentFeature(
            id=f"{row.camera_id}-{row.deployment_number}",
            geometry=DeploymentFeatureGeometry(
                coordinates=[row.lon, row.lat]
            ),
            properties=DeploymentFeatureProperties(
                camera_id=row.camera_id,
                camera_name=row.camera_name,
                deployment_id=row.deployment_number,
                start_date=row.start_date.isoformat(),
                end_date=row.end_date.isoformat() if row.end_date else None,
                trap_days=row.trap_days,
                detection_count=row.detection_count,
                detection_rate=round(row.detection_rate, 4),
                detection_rate_per_100=round(row.detection_rate_per_100, 2),
            )
        )
        features.append(feature)

    return DetectionRateMapResponse(features=features)


# ============================================================================
# New dashboard visualization endpoints
# ============================================================================


class HourlyActivityPoint(BaseModel):
    """Single hour activity count"""
    hour: int  # 0-23
    count: int


class ActivityPatternResponse(BaseModel):
    """Activity pattern response with hourly counts"""
    hours: List[HourlyActivityPoint]
    species: str  # Species name or "all"
    total_detections: int


@router.get(
    "/activity-pattern",
    response_model=ActivityPatternResponse,
)
async def get_activity_pattern(
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get activity pattern showing detections per hour of day (0-23).

    Used for radial/polar charts showing diel activity patterns.
    """
    # Build base query
    query = (
        select(
            func.extract('hour', Image.uploaded_at).label('hour'),
            func.count(Classification.id).label('count')
        )
        .select_from(Classification)
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
    )

    # Apply optional filters
    if species:
        query = query.where(func.lower(Classification.species) == species.lower())

    if start_date:
        query = query.where(func.date(Image.uploaded_at) >= start_date)

    if end_date:
        query = query.where(func.date(Image.uploaded_at) <= end_date)

    # Group by hour
    query = query.group_by(func.extract('hour', Image.uploaded_at)).order_by('hour')

    result = await db.execute(query)
    rows = result.all()

    # Build full 24-hour response (fill missing hours with 0)
    hour_counts = {int(row.hour): row.count for row in rows}
    hours = []
    total = 0
    for h in range(24):
        count = hour_counts.get(h, 0)
        hours.append(HourlyActivityPoint(hour=h, count=count))
        total += count

    return ActivityPatternResponse(
        hours=hours,
        species=species if species else "all",
        total_detections=total,
    )


class SpeciesAccumulationPoint(BaseModel):
    """Single day in species accumulation curve"""
    date: str  # YYYY-MM-DD
    cumulative_species: int
    new_species: List[str]


@router.get(
    "/species-accumulation",
    response_model=List[SpeciesAccumulationPoint],
)
async def get_species_accumulation(
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species accumulation curve showing cumulative species discovered over time.

    Returns the first date each species was detected and cumulative count per day.
    """
    # Get first detection date for each species
    query = (
        select(
            Classification.species,
            func.min(func.date(Image.uploaded_at)).label('first_date')
        )
        .select_from(Classification)
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
    )

    if start_date:
        query = query.where(func.date(Image.uploaded_at) >= start_date)

    if end_date:
        query = query.where(func.date(Image.uploaded_at) <= end_date)

    query = query.group_by(Classification.species)

    result = await db.execute(query)
    rows = result.all()

    # Group species by first detection date
    date_species: Dict[date, List[str]] = {}
    for row in rows:
        d = row.first_date
        if d not in date_species:
            date_species[d] = []
        date_species[d].append(row.species)

    # Build cumulative response
    sorted_dates = sorted(date_species.keys())
    accumulation = []
    cumulative = 0
    all_species: set = set()

    for d in sorted_dates:
        new_species = date_species[d]
        all_species.update(new_species)
        cumulative = len(all_species)
        accumulation.append(SpeciesAccumulationPoint(
            date=d.isoformat(),
            cumulative_species=cumulative,
            new_species=sorted(new_species),
        ))

    return accumulation


class DetectionTrendPoint(BaseModel):
    """Daily detection count"""
    date: str  # YYYY-MM-DD
    count: int


@router.get(
    "/detection-trend",
    response_model=List[DetectionTrendPoint],
)
async def get_detection_trend(
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get detection counts per day, optionally filtered by species.

    Defaults to last 30 days if no date range specified.
    """
    # Default to last 30 days
    if not start_date and not end_date:
        end_dt = datetime.now(timezone.utc).date()
        start_dt = end_dt - timedelta(days=30)
    else:
        start_dt = start_date
        end_dt = end_date

    query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Classification.id).label('count')
        )
        .select_from(Classification)
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
    )

    if species:
        query = query.where(func.lower(Classification.species) == species.lower())

    if start_dt:
        query = query.where(func.date(Image.uploaded_at) >= start_dt)

    if end_dt:
        query = query.where(func.date(Image.uploaded_at) <= end_dt)

    query = query.group_by(func.date(Image.uploaded_at)).order_by('date')

    result = await db.execute(query)
    rows = result.all()

    return [
        DetectionTrendPoint(date=row.date.isoformat(), count=row.count)
        for row in rows
    ]


class ConfidenceBin(BaseModel):
    """Detection confidence histogram bin"""
    bin_label: str  # e.g., "0.5-0.6"
    bin_min: float
    bin_max: float
    count: int


@router.get(
    "/confidence-distribution",
    response_model=List[ConfidenceBin],
)
async def get_confidence_distribution(
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get distribution of detection confidences as histogram bins.

    Returns counts for each 0.1-width bin from 0.0 to 1.0.
    """
    # Define bins (0.0-0.1, 0.1-0.2, ..., 0.9-1.0)
    bins = [(i / 10, (i + 1) / 10) for i in range(10)]

    query = (
        select(Detection.confidence)
        .join(Image)
        .join(Camera)
        .where(Camera.project_id.in_(accessible_project_ids))
    )

    if start_date:
        query = query.where(func.date(Image.uploaded_at) >= start_date)

    if end_date:
        query = query.where(func.date(Image.uploaded_at) <= end_date)

    result = await db.execute(query)
    confidences = [row[0] for row in result.all()]

    # Count per bin
    bin_counts = []
    for bin_min, bin_max in bins:
        count = sum(1 for c in confidences if bin_min <= c < bin_max)
        # Handle edge case: 1.0 goes in last bin
        if bin_max == 1.0:
            count += sum(1 for c in confidences if c == 1.0)
        bin_counts.append(ConfidenceBin(
            bin_label=f"{bin_min:.1f}-{bin_max:.1f}",
            bin_min=bin_min,
            bin_max=bin_max,
            count=count,
        ))

    return bin_counts


class OccupancyMatrixResponse(BaseModel):
    """Species x Camera occupancy matrix"""
    cameras: List[str]  # Camera names
    species: List[str]  # Species names
    matrix: List[List[int]]  # matrix[species_idx][camera_idx] = detection count


@router.get(
    "/occupancy-matrix",
    response_model=OccupancyMatrixResponse,
)
async def get_occupancy_matrix(
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species x camera detection counts as a matrix.

    Used for heatmap visualization showing which species appear at which cameras.
    """
    query = (
        select(
            Camera.name.label('camera_name'),
            Classification.species,
            func.count(Classification.id).label('count')
        )
        .select_from(Classification)
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
    )

    if start_date:
        query = query.where(func.date(Image.uploaded_at) >= start_date)

    if end_date:
        query = query.where(func.date(Image.uploaded_at) <= end_date)

    query = query.group_by(Camera.name, Classification.species)

    result = await db.execute(query)
    rows = result.all()

    # Build sets of cameras and species
    cameras_set: set = set()
    species_set: set = set()
    counts: Dict[tuple, int] = {}

    for row in rows:
        cameras_set.add(row.camera_name)
        species_set.add(row.species)
        counts[(row.species, row.camera_name)] = row.count

    # Sort for consistent ordering
    cameras = sorted(cameras_set)
    species_list = sorted(species_set)

    # Build matrix: rows = species, columns = cameras
    matrix = []
    for sp in species_list:
        row = [counts.get((sp, cam), 0) for cam in cameras]
        matrix.append(row)

    return OccupancyMatrixResponse(
        cameras=cameras,
        species=species_list,
        matrix=matrix,
    )


class PipelineStatusResponse(BaseModel):
    """Image processing pipeline status"""
    pending: int
    classified: int
    total_images: int
    person_count: int
    vehicle_count: int
    animal_count: int


@router.get(
    "/pipeline-status",
    response_model=PipelineStatusResponse,
)
async def get_pipeline_status(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get image processing pipeline status and detection category counts.

    Shows pending vs classified images and counts of person/vehicle/animal detections.
    """
    # Count images by status
    pending_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.status != "classified"
            )
        )
    )
    pending = pending_result.scalar_one()

    classified_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.status == "classified"
            )
        )
    )
    classified = classified_result.scalar_one()

    # Count detections by category
    category_result = await db.execute(
        select(
            Detection.category,
            func.count(Detection.id).label('count')
        )
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Detection.category)
    )
    category_rows = category_result.all()

    category_counts = {row.category: row.count for row in category_rows}

    return PipelineStatusResponse(
        pending=pending,
        classified=classified,
        total_images=pending + classified,
        person_count=category_counts.get('person', 0),
        vehicle_count=category_counts.get('vehicle', 0),
        animal_count=category_counts.get('animal', 0),
    )
