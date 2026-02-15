"""
Statistics endpoints for dashboard metrics and charts.
"""
from typing import List, Optional, Any, Dict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc, text
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification, Project, HumanObservation, ServerSettings
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids, narrow_to_project
from utils.preferred_counts import (
    get_preferred_species_counts,
    get_preferred_unique_species,
    get_preferred_total_species_count,
    get_preferred_hourly_activity,
    get_preferred_daily_trend,
    get_preferred_species_first_dates,
    get_preferred_species_camera_matrix,
)
from utils.independence_filter import (
    get_independent_species_counts,
    get_independent_hourly_activity,
    get_independent_daily_trend,
    get_independent_species_camera_matrix,
    get_independent_detection_rate_counts,
)


router = APIRouter(prefix="/api/statistics", tags=["statistics"])


async def _get_independence_interval(db: AsyncSession, project_id: Optional[int]) -> int:
    """Load independence interval for a single project. Returns 0 for cross-project views."""
    if project_id is None:
        return 0
    result = await db.execute(
        select(Project.independence_interval_minutes).where(Project.id == project_id)
    )
    return result.scalar_one_or_none() or 0


class StatisticsOverview(BaseModel):
    """Dashboard overview statistics"""
    total_images: int
    total_cameras: int
    total_species: int
    images_today: int
    first_image_date: Optional[str]  # YYYY-MM-DD or null if no images
    last_image_date: Optional[str]  # YYYY-MM-DD or null if no images


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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
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

    # Total unique species (preferring human observations for verified images)
    total_species = await get_preferred_total_species_count(db, accessible_project_ids)

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

    # First and last image dates (for date picker bounds)
    first_image_result = await db.execute(
        select(func.min(func.date(Image.uploaded_at)))
        .join(Camera)
        .where(Camera.project_id.in_(accessible_project_ids))
    )
    first_image_date = first_image_result.scalar_one()

    last_image_result = await db.execute(
        select(func.max(func.date(Image.uploaded_at)))
        .join(Camera)
        .where(Camera.project_id.in_(accessible_project_ids))
    )
    last_image_date = last_image_result.scalar_one()

    return StatisticsOverview(
        total_images=total_images,
        total_cameras=total_cameras,
        total_species=total_species,
        images_today=images_today,
        first_image_date=first_image_date.isoformat() if first_image_date else None,
        last_image_date=last_image_date.isoformat() if last_image_date else None,
    )


@router.get(
    "/images-timeline",
    response_model=List[TimelineDataPoint],
)
async def get_images_timeline(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species distribution (top 10, filtered by accessible projects)

    Prefers human observations for verified images, falls back to AI for unverified.

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of species with counts (top 10 by count)
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = await _get_independence_interval(db, project_id)

    if interval > 0:
        counts = await get_independent_species_counts(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            limit=10,
        )
    else:
        counts = await get_preferred_species_counts(
            db=db,
            project_ids=accessible_project_ids,
            limit=10,
        )

    return [SpeciesCount(species=c['species'], count=c['count']) for c in counts]


@router.get(
    "/camera-activity",
    response_model=CameraActivitySummary,
)
async def get_camera_activity(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    # Query most recent classified image
    query = (
        select(Image)
        .join(Camera, Image.camera_id == Camera.id)
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

    # Get server timezone
    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)

    # uploaded_at is set from EXIF capture time by the ingestion pipeline,
    # stored as UTC but actually in the camera's local timezone (server timezone).
    # Re-interpret it in the correct timezone, then convert to real UTC.
    naive_dt = image.uploaded_at.replace(tzinfo=None)
    local_dt = naive_dt.replace(tzinfo=ZoneInfo(server_tz))
    utc_dt = local_dt.astimezone(timezone.utc)

    return LastUpdateResponse(last_update=utc_dt.isoformat())


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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = await _get_independence_interval(db, project_id)

    # Build SQL query with conditional filters
    # Use UNION to combine verified (human observations) and unverified (AI) counts
    # For verified images: sum HumanObservation.count
    # For unverified images: count Detection/Classification with threshold
    query_sql = """
        WITH verified_counts AS (
            -- Counts from human observations (verified images only)
            SELECT
                cdp.id as deployment_id,
                COALESCE(SUM(ho.count) FILTER (WHERE
                    ho.id IS NOT NULL
                    AND (CAST(:species AS text) IS NULL OR LOWER(ho.species) = LOWER(CAST(:species AS text)))
                    AND (CAST(:start_date AS date) IS NULL OR i.uploaded_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.uploaded_at::date <= CAST(:end_date AS date))
                ), 0) as detection_count
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.is_verified = true
                AND i.uploaded_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.uploaded_at::date <= cdp.end_date)
            LEFT JOIN human_observations ho ON ho.image_id = i.id
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY cdp.id
        ),
        unverified_counts AS (
            -- Counts from AI detections (unverified images only)
            SELECT
                cdp.id as deployment_id,
                COUNT(d.id) FILTER (WHERE
                    d.id IS NOT NULL
                    AND d.confidence >= p.detection_threshold
                    AND (CAST(:species AS text) IS NULL OR LOWER(cl.species) = LOWER(CAST(:species AS text)))
                    AND (CAST(:start_date AS date) IS NULL OR i.uploaded_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.uploaded_at::date <= CAST(:end_date AS date))
                ) as detection_count
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.is_verified = false
                AND i.uploaded_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.uploaded_at::date <= cdp.end_date)
            LEFT JOIN detections d ON d.image_id = i.id
            LEFT JOIN classifications cl ON cl.detection_id = d.id
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY cdp.id
        ),
        combined_counts AS (
            -- Sum verified and unverified counts per deployment
            SELECT
                deployment_id,
                SUM(detection_count) as detection_count
            FROM (
                SELECT deployment_id, detection_count FROM verified_counts
                UNION ALL
                SELECT deployment_id, detection_count FROM unverified_counts
            ) combined
            GROUP BY deployment_id
        ),
        deployment_info AS (
            -- Get deployment metadata
            SELECT
                cdp.id as deployment_id,
                cdp.camera_id,
                cdp.deployment_id as deployment_number,
                cdp.start_date,
                cdp.end_date,
                ST_X(cdp.location::geometry) as lon,
                ST_Y(cdp.location::geometry) as lat,
                COALESCE(
                    (cdp.end_date - cdp.start_date + 1),
                    (CURRENT_DATE - cdp.start_date + 1)
                ) as trap_days,
                c.name as camera_name
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            WHERE c.project_id = ANY(:project_ids)
        )
        SELECT
            di.camera_id,
            di.camera_name,
            di.deployment_number,
            di.start_date,
            di.end_date,
            di.lon,
            di.lat,
            di.trap_days,
            COALESCE(cc.detection_count, 0) as detection_count,
            CASE
                WHEN di.trap_days > 0 THEN COALESCE(cc.detection_count, 0)::float / di.trap_days
                ELSE 0.0
            END as detection_rate,
            CASE
                WHEN di.trap_days > 0 THEN (COALESCE(cc.detection_count, 0)::float / di.trap_days) * 100
                ELSE 0.0
            END as detection_rate_per_100
        FROM deployment_info di
        LEFT JOIN combined_counts cc ON cc.deployment_id = di.deployment_id
        ORDER BY di.camera_id, di.deployment_number
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

    # When independence interval is active, override detection counts
    indep_counts = None
    if interval > 0:
        start_dt = datetime.combine(start_date, datetime.min.time()) if start_date else None
        end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None
        indep_counts = await get_independent_detection_rate_counts(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
        )

    # Convert to GeoJSON features
    features = []
    for row in rows:
        det_count = row.detection_count
        trap_days = row.trap_days

        if indep_counts is not None:
            det_count = indep_counts.get((row.camera_id, row.deployment_number), 0)

        det_rate = det_count / trap_days if trap_days > 0 else 0.0
        det_rate_100 = det_rate * 100

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
                trap_days=trap_days,
                detection_count=det_count,
                detection_rate=round(det_rate, 4),
                detection_rate_per_100=round(det_rate_100, 2),
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get activity pattern showing detections per hour of day (0-23).

    Prefers human observations for verified images, falls back to AI for unverified.
    Used for radial/polar charts showing diel activity patterns.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = await _get_independence_interval(db, project_id)

    # Convert date to datetime for the helper
    start_dt = datetime.combine(start_date, datetime.min.time()) if start_date else None
    end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None

    if interval > 0:
        hourly_data = await get_independent_hourly_activity(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
        )
    else:
        hourly_data = await get_preferred_hourly_activity(
            db=db,
            project_ids=accessible_project_ids,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
        )

    # Build full 24-hour response (fill missing hours with 0)
    hour_counts = {d['hour']: d['count'] for d in hourly_data}
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species accumulation curve showing cumulative species discovered over time.

    Prefers human observations for verified images, falls back to AI for unverified.
    Returns the first date each species was observed and cumulative count per day.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    # Convert dates
    start_dt = datetime.combine(start_date, datetime.min.time()) if start_date else None
    end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None

    # Get first observation date for each species from preferred source
    species_data = await get_preferred_species_first_dates(
        db=db,
        project_ids=accessible_project_ids,
        start_date=start_dt,
        end_date=end_dt,
    )

    # Convert to row-like format for existing logic
    rows = [(d['species'], d['first_date']) for d in species_data]

    # Group species by first observation date
    date_species: Dict[date, List[str]] = {}
    for species, first_date in rows:
        if first_date not in date_species:
            date_species[first_date] = []
        date_species[first_date].append(species)

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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get detection counts per day, optionally filtered by species.

    Prefers human observations for verified images, falls back to AI for unverified.
    Defaults to last 30 days if no date range specified.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = await _get_independence_interval(db, project_id)

    # Default to last 30 days
    if not start_date and not end_date:
        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=30)
    else:
        start_dt = datetime.combine(start_date, datetime.min.time()) if start_date else None
        end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None

    if interval > 0:
        daily_data = await get_independent_daily_trend(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
        )
    else:
        daily_data = await get_preferred_daily_trend(
            db=db,
            project_ids=accessible_project_ids,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
        )

    return [
        DetectionTrendPoint(date=d['date'], count=d['count'])
        for d in daily_data
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
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
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
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
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get species x camera detection counts as a matrix.

    Prefers human observations for verified images, falls back to AI for unverified.
    Used for heatmap visualization showing which species appear at which cameras.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = await _get_independence_interval(db, project_id)

    # Convert dates for helper function
    start_dt = datetime.combine(start_date, datetime.min.time()) if start_date else None
    end_dt = datetime.combine(end_date, datetime.max.time()) if end_date else None

    # Get camera × species matrix from preferred source
    if interval > 0:
        matrix_data = await get_independent_species_camera_matrix(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            start_date=start_dt,
            end_date=end_dt,
        )
    else:
        matrix_data = await get_preferred_species_camera_matrix(
            db=db,
            project_ids=accessible_project_ids,
            start_date=start_dt,
            end_date=end_dt,
        )

    # Build sets of cameras and species
    cameras_set: set = set()
    species_set: set = set()
    counts: Dict[tuple, int] = {}

    for row in matrix_data:
        cameras_set.add(row['camera_name'])
        species_set.add(row['species'])
        counts[(row['species'], row['camera_name'])] = row['count']

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
    empty_count: int


@router.get(
    "/pipeline-status",
    response_model=PipelineStatusResponse,
)
async def get_pipeline_status(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get image processing pipeline status and detection category counts.

    Shows pending vs classified images and counts of person/vehicle/animal detections.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
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

    # Count detections by category (only from UNVERIFIED images)
    # Verified images use human observations, not AI detections
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
                Image.is_verified == False,  # Only count unverified images
                Detection.confidence >= Project.detection_threshold
            )
        )
        .group_by(Detection.category)
    )
    category_rows = category_result.all()

    category_counts = {row.category: row.count for row in category_rows}

    # Count empty images
    # For verified images: no HumanObservation rows
    # For unverified images: no detections above threshold

    # Verified images with observations
    verified_with_observations = (
        select(HumanObservation.image_id)
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.is_verified == True
            )
        )
        .distinct()
    )

    # Count verified empty (verified but no observations)
    verified_empty_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.is_verified == True,
                ~Image.id.in_(verified_with_observations)
            )
        )
    )
    verified_empty = verified_empty_result.scalar_one()

    # Unverified images with detections above threshold
    unverified_with_detections = (
        select(Detection.image_id)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.is_verified == False,
                Image.status == "classified",
                Detection.confidence >= Project.detection_threshold
            )
        )
        .distinct()
    )

    # Count unverified empty (classified, not verified, no detections)
    unverified_empty_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Camera.project_id.in_(accessible_project_ids),
                Image.status == "classified",
                Image.is_verified == False,
                ~Image.id.in_(unverified_with_detections)
            )
        )
    )
    unverified_empty = unverified_empty_result.scalar_one()

    empty_count = verified_empty + unverified_empty

    return PipelineStatusResponse(
        pending=pending,
        classified=classified,
        total_images=pending + classified,
        person_count=category_counts.get('person', 0),
        vehicle_count=category_counts.get('vehicle', 0),
        animal_count=category_counts.get('animal', 0),
        empty_count=empty_count,
    )


class DetectionCountSpecies(BaseModel):
    species: str
    count: int


class DetectionCountResponse(BaseModel):
    total: int
    species: List[DetectionCountSpecies]


@router.get(
    "/detection-count",
    response_model=DetectionCountResponse,
)
async def get_detection_count(
    project_id: int = Query(..., description="Project ID (required)"),
    threshold: float = Query(..., description="Confidence threshold (0-1)"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Count detections per species at a given confidence threshold.

    Verified images use human observation counts (unaffected by threshold).
    Unverified images count AI classifications above the threshold.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    # Verified: human observations grouped by species (threshold doesn't apply)
    verified_query = (
        select(
            HumanObservation.species.label('species'),
            func.sum(HumanObservation.count).label('count'),
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.is_verified == True,
                Camera.project_id.in_(accessible_project_ids),
            )
        )
        .group_by(HumanObservation.species)
    )

    # Unverified: AI classifications above threshold, grouped by species
    unverified_query = (
        select(
            Classification.species.label('species'),
            func.count(Classification.id).label('count'),
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.is_verified == False,
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= threshold,
            )
        )
        .group_by(Classification.species)
    )

    # Combine and sum per species
    from sqlalchemy import union_all
    combined = union_all(verified_query, unverified_query).subquery()
    final_query = (
        select(
            combined.c.species,
            func.sum(combined.c.count).label('total_count'),
        )
        .group_by(combined.c.species)
        .order_by(func.sum(combined.c.count).desc())
    )

    result = await db.execute(final_query)
    rows = result.all()

    species_list = [
        DetectionCountSpecies(species=row.species, count=int(row.total_count))
        for row in rows
    ]
    total = sum(s.count for s in species_list)

    return DetectionCountResponse(total=total, species=species_list)


class IndependenceSummarySpecies(BaseModel):
    species: str
    raw_count: int
    independent_count: int


class IndependenceSummaryResponse(BaseModel):
    raw_total: int
    independent_total: int
    species: List[IndependenceSummarySpecies]


@router.get(
    "/independence-summary",
    response_model=IndependenceSummaryResponse,
)
async def get_independence_summary(
    project_id: int = Query(..., description="Project ID (required)"),
    interval_minutes: Optional[int] = Query(None, description="Override interval (uses project setting if omitted)"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Compare raw detection counts vs independence-filtered event counts.

    Returns per-species breakdown showing the effect of the independence interval.
    If interval_minutes is provided, uses that instead of the project's saved setting.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    interval = interval_minutes if interval_minutes is not None else await _get_independence_interval(db, project_id)

    if interval == 0:
        return IndependenceSummaryResponse(
            raw_total=0,
            independent_total=0,
            species=[],
        )

    # Get raw counts (no independence filtering)
    raw_counts = await get_preferred_species_counts(
        db=db,
        project_ids=accessible_project_ids,
    )

    # Get independence-filtered counts
    indep_counts = await get_independent_species_counts(
        db=db,
        project_ids=accessible_project_ids,
        interval_minutes=interval,
    )

    # Build lookup for independent counts
    indep_lookup = {c['species']: c['count'] for c in indep_counts}

    # Merge: use raw species list as base (it has all species)
    species_list = []
    raw_total = 0
    indep_total = 0
    for rc in raw_counts:
        sp = rc['species']
        raw_c = rc['count']
        indep_c = indep_lookup.get(sp, 0)
        raw_total += raw_c
        indep_total += indep_c
        species_list.append(IndependenceSummarySpecies(
            species=sp,
            raw_count=raw_c,
            independent_count=indep_c,
        ))

    return IndependenceSummaryResponse(
        raw_total=raw_total,
        independent_total=indep_total,
        species=species_list,
    )
