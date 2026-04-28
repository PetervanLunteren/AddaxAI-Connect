"""
Statistics endpoints for dashboard metrics and charts.
"""
from typing import List, Optional, Any, Dict, Tuple
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select, func, and_, desc, text
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification, Project, HumanObservation, ServerSettings
from shared.classification_threshold import (
    classification_passes_threshold,
    CLASSIFICATION_THRESHOLD_FILTER_SQL,
    effective_classification_threshold,
)
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
    get_independent_event_counts,
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


async def _server_now(db: AsyncSession) -> datetime:
    """
    Return the current wall-clock time in the server's declared timezone, as a naive
    datetime. Use this whenever constructing a bound that will be compared against
    Image.captured_at or CameraHealthReport.reported_at, both of which are stored
    naive and interpreted under ServerSettings.timezone.
    """
    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return datetime.now(tz).replace(tzinfo=None)


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
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
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
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None

    # Total images (filtered by project via camera, excluding hidden)
    img_conditions = [Camera.project_id.in_(accessible_project_ids), Image.is_hidden == False]
    if camera_id_list:
        img_conditions.append(Image.camera_id.in_(camera_id_list))
    total_images_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(and_(*img_conditions))
    )
    total_images = total_images_result.scalar_one()

    # Total cameras (filtered by project)
    cam_conditions = [Camera.project_id.in_(accessible_project_ids)]
    if camera_id_list:
        cam_conditions.append(Camera.id.in_(camera_id_list))
    total_cameras_result = await db.execute(
        select(func.count(Camera.id))
        .where(and_(*cam_conditions))
    )
    total_cameras = total_cameras_result.scalar_one()

    # Total unique species (preferring human observations for verified images)
    total_species = await get_preferred_total_species_count(db, accessible_project_ids, camera_ids=camera_id_list)

    # Images today (filtered by project). "Today" is the server's local calendar day,
    # matching the naive captured_at convention.
    today_start = (await _server_now(db)).replace(hour=0, minute=0, second=0, microsecond=0)
    today_conditions = [
        Image.captured_at >= today_start,
        Camera.project_id.in_(accessible_project_ids),
        Image.is_hidden == False,
    ]
    if camera_id_list:
        today_conditions.append(Image.camera_id.in_(camera_id_list))
    images_today_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(and_(*today_conditions))
    )
    images_today = images_today_result.scalar_one()

    # First and last image dates (for date picker bounds)
    date_conditions = [Camera.project_id.in_(accessible_project_ids), Image.is_hidden == False]
    if camera_id_list:
        date_conditions.append(Image.camera_id.in_(camera_id_list))
    first_image_result = await db.execute(
        select(func.min(func.date(Image.captured_at)))
        .join(Camera)
        .where(and_(*date_conditions))
    )
    first_image_date = first_image_result.scalar_one()

    last_image_result = await db.execute(
        select(func.max(func.date(Image.captured_at)))
        .join(Camera)
        .where(and_(*date_conditions))
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
    # Calculate date range in the server's local calendar day (matches naive captured_at).
    end_date = (await _server_now(db)).replace(hour=0, minute=0, second=0, microsecond=0)
    num_days = days if days is not None else 30
    start_date = end_date - timedelta(days=num_days) if num_days > 0 else None

    # Query images grouped by date (filtered by project via camera)
    conditions = [Camera.project_id.in_(accessible_project_ids), Image.is_hidden == False]
    if start_date is not None:
        conditions.append(Image.captured_at >= start_date)

    query = (
        select(
            func.date(Image.captured_at).label('date'),
            func.count(Image.id).label('count')
        )
        .join(Camera)
        .where(and_(*conditions))
        .group_by(func.date(Image.captured_at))
        .order_by(func.date(Image.captured_at))
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
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
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
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None
    interval = await _get_independence_interval(db, project_id)

    if interval > 0:
        counts = await get_independent_species_counts(
            db=db,
            project_ids=accessible_project_ids,
            interval_minutes=interval,
            limit=10,
            camera_ids=camera_id_list,
        )
    else:
        counts = await get_preferred_species_counts(
            db=db,
            project_ids=accessible_project_ids,
            limit=10,
            camera_ids=camera_id_list,
        )

    return [SpeciesCount(species=c['species'], count=c['count']) for c in counts]


@router.get(
    "/camera-activity",
    response_model=CameraActivitySummary,
)
async def get_camera_activity(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
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
    from shared.models import CameraHealthReport

    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None

    # Pair each accessible camera with the timestamp of its latest health report (NULL if never reported).
    cam_conditions = [Camera.project_id.in_(accessible_project_ids)]
    if camera_id_list:
        cam_conditions.append(Camera.id.in_(camera_id_list))
    result = await db.execute(
        select(Camera.id, func.max(CameraHealthReport.reported_at))
        .outerjoin(CameraHealthReport, CameraHealthReport.camera_id == Camera.id)
        .where(and_(*cam_conditions))
        .group_by(Camera.id)
    )

    # reported_at is naive camera-clock; cutoff must also be naive. A few-hour drift
    # from the true local-vs-UTC offset is irrelevant for a 7-day window.
    cutoff = datetime.utcnow() - timedelta(days=7)

    active_count = 0
    inactive_count = 0
    never_reported_count = 0
    for _, last_reported_at in result.all():
        if last_reported_at is None:
            never_reported_count += 1
        elif last_reported_at >= cutoff:
            active_count += 1
        else:
            inactive_count += 1

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
    Get the camera-clock timestamp of the most recently classified image
    (filtered by accessible projects), serialized as an ISO 8601 instant in
    UTC. The frontend renders it in the user's browser locale.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    query = (
        select(Image.captured_at)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.status == "classified",
                Image.is_hidden == False,
                Camera.project_id.in_(accessible_project_ids)
            )
        )
        .order_by(desc(Image.captured_at))
        .limit(1)
    )

    result = await db.execute(query)
    captured_at = result.scalar_one_or_none()

    if captured_at is None:
        return LastUpdateResponse(last_update=None)

    # Camera-clock naive datetime, interpret under the server's declared tz, serialize as UTC.
    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)
    utc_dt = captured_at.replace(tzinfo=ZoneInfo(server_tz)).astimezone(timezone.utc)
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
                    AND (CAST(:start_date AS date) IS NULL OR i.captured_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.captured_at::date <= CAST(:end_date AS date))
                ), 0) as detection_count
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.is_verified = true
                AND i.captured_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.captured_at::date <= cdp.end_date)
            LEFT JOIN human_observations ho ON ho.image_id = i.id
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY cdp.id
        ),
        unverified_counts AS (
            -- Counts from AI detections (unverified images only).
            -- The COALESCE(...) clause is the per-species classification
            -- threshold filter — sub-threshold classifications are excluded
            -- from the count.
            SELECT
                cdp.id as deployment_id,
                COUNT(d.id) FILTER (WHERE
                    d.id IS NOT NULL
                    AND d.confidence >= p.detection_threshold
                    AND cl.confidence >= COALESCE(
                        (p.classification_thresholds->'overrides'->>cl.species)::float,
                        (p.classification_thresholds->>'default')::float,
                        0.0
                    )
                    AND (CAST(:species AS text) IS NULL OR LOWER(cl.species) = LOWER(CAST(:species AS text)))
                    AND (CAST(:start_date AS date) IS NULL OR i.captured_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.captured_at::date <= CAST(:end_date AS date))
                ) as detection_count
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.is_verified = false
                AND i.captured_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.captured_at::date <= cdp.end_date)
            LEFT JOIN detections d ON d.image_id = i.id
            LEFT JOIN classifications cl ON cl.detection_id = d.id
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY cdp.id
        ),
        pv_counts AS (
            -- Counts from person/vehicle detections (unverified images only)
            SELECT
                cdp.id as deployment_id,
                COUNT(d.id) FILTER (WHERE
                    d.id IS NOT NULL
                    AND d.confidence >= p.detection_threshold
                    AND d.category IN ('person', 'vehicle')
                    AND (CAST(:species AS text) IS NULL OR LOWER(d.category) = LOWER(CAST(:species AS text)))
                    AND (CAST(:start_date AS date) IS NULL OR i.captured_at::date >= CAST(:start_date AS date))
                    AND (CAST(:end_date AS date) IS NULL OR i.captured_at::date <= CAST(:end_date AS date))
                ) as detection_count
            FROM camera_deployment_periods cdp
            INNER JOIN cameras c ON cdp.camera_id = c.id
            INNER JOIN projects p ON c.project_id = p.id
            LEFT JOIN images i ON
                i.camera_id = cdp.camera_id
                AND i.is_verified = false
                AND i.captured_at::date >= cdp.start_date
                AND (cdp.end_date IS NULL OR i.captured_at::date <= cdp.end_date)
            LEFT JOIN detections d ON d.image_id = i.id AND d.category IN ('person', 'vehicle')
            WHERE c.project_id = ANY(:project_ids)
            GROUP BY cdp.id
        ),
        combined_counts AS (
            -- Sum verified, unverified, and person/vehicle counts per deployment
            SELECT
                deployment_id,
                SUM(detection_count) as detection_count
            FROM (
                SELECT deployment_id, detection_count FROM verified_counts
                UNION ALL
                SELECT deployment_id, detection_count FROM unverified_counts
                UNION ALL
                SELECT deployment_id, detection_count FROM pv_counts
            ) combined
            GROUP BY deployment_id
        ),
        deployment_info AS (
            -- Get deployment metadata. The two extra WHERE clauses below are
            -- defense in depth: the ingestion path now rejects invalid GPS
            -- and clamps same-day relocations, but we still skip Null Island
            -- deployments and inverted-date zombies in case any future code
            -- path or restored backup re-introduces a bad row.
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
              AND NOT (ST_X(cdp.location::geometry) = 0 AND ST_Y(cdp.location::geometry) = 0)
              AND (cdp.end_date IS NULL OR cdp.end_date >= cdp.start_date)
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


class SunBands(BaseModel):
    """
    Astronomical day boundaries in fractional hours (0-24) in the project
    timezone, used by the activity pattern chart to colour the bars by
    night / dawn / day / dusk.
    """
    dawn: float      # start of civil twilight (sun 6 deg below horizon)
    sunrise: float   # day begins (sun crosses horizon)
    sunset: float    # day ends (sun crosses horizon)
    dusk: float      # end of civil twilight


class ActivityPatternResponse(BaseModel):
    """Activity pattern response with hourly counts"""
    hours: List[HourlyActivityPoint]
    species: str  # Species name or "all"
    total_detections: int
    sun_bands: Optional[SunBands] = None  # null when no project camera GPS or polar day/night
    timezone: str  # IANA name used to extract hours and to compute bands


def _avg_camera_location(camera_configs) -> Optional[Tuple[float, float]]:
    """
    Average lat/lon across cameras whose config has 'gps_from_report'.
    The canonical GPS source is Camera.config['gps_from_report'] (a
    {'lat': ..., 'lon': ...} dict set by the daily camera health report
    parser); the PostGIS Camera.location column is unused. Returns None
    when no cameras in the project have GPS. The activity pattern
    endpoint uses this single point to ground its sun band calculation,
    which is good enough as long as the cameras are within a few hundred
    km of each other.
    """
    points: list[Tuple[float, float]] = []
    for config in camera_configs:
        if not config:
            continue
        gps = config.get('gps_from_report')
        if not gps:
            continue
        try:
            points.append((float(gps['lat']), float(gps['lon'])))
        except (KeyError, TypeError, ValueError):
            continue
    if not points:
        return None
    avg_lat = sum(p[0] for p in points) / len(points)
    avg_lon = sum(p[1] for p in points) / len(points)
    return (avg_lat, avg_lon)


def _compute_sun_bands(
    lat: float,
    lon: float,
    reference_date: date,
    tz_name: str,
) -> Optional[SunBands]:
    """
    Compute dawn / sunrise / sunset / dusk for the given location and
    reference date in the given timezone. Returns None when the sun
    never rises or never sets at that latitude on that date (polar day
    or polar night), in which case the frontend falls back to its
    hardcoded bands.
    """
    from astral import LocationInfo
    from astral.sun import sun

    try:
        location = LocationInfo("project", "project", tz_name, lat, lon)
        s = sun(location.observer, date=reference_date, tzinfo=ZoneInfo(tz_name))
    except ValueError:
        return None

    def to_fractional_hour(dt) -> float:
        return dt.hour + dt.minute / 60 + dt.second / 3600

    return SunBands(
        dawn=to_fractional_hour(s['dawn']),
        sunrise=to_fractional_hour(s['sunrise']),
        sunset=to_fractional_hour(s['sunset']),
        dusk=to_fractional_hour(s['dusk']),
    )


@router.get(
    "/activity-pattern",
    response_model=ActivityPatternResponse,
)
async def get_activity_pattern(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    species: Optional[str] = Query(None, description="Filter by species (case-insensitive)"),
    start_date: Optional[date] = Query(None, description="Filter from this date"),
    end_date: Optional[date] = Query(None, description="Filter to this date"),
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
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
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None
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
            camera_ids=camera_id_list,
        )
    else:
        hourly_data = await get_preferred_hourly_activity(
            db=db,
            project_ids=accessible_project_ids,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
            camera_ids=camera_id_list,
        )

    # Build full 24-hour response (fill missing hours with 0)
    hour_counts = {d['hour']: d['count'] for d in hourly_data}
    hours = []
    total = 0
    for h in range(24):
        count = hour_counts.get(h, 0)
        hours.append(HourlyActivityPoint(hour=h, count=count))
        total += count

    # Compute the timezone label and astronomical sun bands. The server
    # timezone setting is the user's declaration of which timezone the
    # camera clocks are set to (some projects deliberately run their
    # cameras on UTC for cross-site consistency, so deriving the
    # timezone from GPS would silently override the user's choice). The
    # bands need a single project to be meaningful; cross-project view
    # falls back to the frontend's hardcoded ranges.
    from routers.admin import get_server_timezone
    server_tz = await get_server_timezone(db)

    sun_bands: Optional[SunBands] = None
    if project_id is not None:
        cam_result = await db.execute(
            select(Camera.config).where(Camera.project_id == project_id)
        )
        avg = _avg_camera_location(cam_result.scalars().all())
        if avg is not None:
            if start_date and end_date:
                ref_date = start_date + (end_date - start_date) / 2
            elif start_date:
                ref_date = start_date
            elif end_date:
                ref_date = end_date
            else:
                ref_date = date.today()
            sun_bands = _compute_sun_bands(avg[0], avg[1], ref_date, server_tz)

    return ActivityPatternResponse(
        hours=hours,
        species=species if species else "all",
        total_detections=total,
        sun_bands=sun_bands,
        timezone=server_tz,
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
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
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
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None
    interval = await _get_independence_interval(db, project_id)

    # Default to last 30 days. Use the server's local wall clock so the window
    # lines up with the naive captured_at convention.
    if not start_date and not end_date:
        end_dt = await _server_now(db)
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
            camera_ids=camera_id_list,
        )
    else:
        daily_data = await get_preferred_daily_trend(
            db=db,
            project_ids=accessible_project_ids,
            species_filter=species,
            start_date=start_dt,
            end_date=end_dt,
            camera_ids=camera_id_list,
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
        query = query.where(func.date(Image.captured_at) >= start_date)

    if end_date:
        query = query.where(func.date(Image.captured_at) <= end_date)

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
    camera_ids: Optional[str] = Query(None, description="Comma-separated camera IDs"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Image processing pipeline status and per-image category breakdown.

    Each visible image is bucketed into exactly one of person, vehicle, animal,
    or empty (in that priority order). Verified images draw on HumanObservation;
    unverified images draw on Detection, with classification threshold applied
    for the animal bucket. The four counts sum to the project's total visible
    images that are either verified or fully classified.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    camera_id_list = [int(x.strip()) for x in camera_ids.split(',') if x.strip()] if camera_ids else None

    if not accessible_project_ids:
        return PipelineStatusResponse(
            pending=0, classified=0, total_images=0,
            person_count=0, vehicle_count=0, animal_count=0, empty_count=0,
        )

    # Pipeline progress counts
    pending_conditions = [
        Camera.project_id.in_(accessible_project_ids),
        Image.status != "classified",
    ]
    if camera_id_list:
        pending_conditions.append(Image.camera_id.in_(camera_id_list))
    pending_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(and_(*pending_conditions))
    )
    pending = pending_result.scalar_one()

    classified_conditions = [
        Camera.project_id.in_(accessible_project_ids),
        Image.status == "classified",
        Image.is_hidden == False,
    ]
    if camera_id_list:
        classified_conditions.append(Image.camera_id.in_(camera_id_list))
    classified_result = await db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(and_(*classified_conditions))
    )
    classified = classified_result.scalar_one()

    # Per-image category breakdown. An image is in scope when it is visible
    # AND either verified or fully classified, so in-progress images are not
    # pre-bucketed as empty. Verified images use HumanObservation; unverified
    # images use Detection (and Classification with the per-species threshold
    # for animals). Priority on overlap is person > vehicle > animal > empty,
    # so the four counts add up to the visible-and-decided image total.
    camera_clause = "AND i.camera_id = ANY(:camera_ids)" if camera_id_list else ""
    category_sql = text(f"""
        WITH scope AS (
            SELECT
                i.id,
                i.is_verified,
                p.detection_threshold,
                p.classification_thresholds
            FROM images i
            JOIN cameras c ON i.camera_id = c.id
            JOIN projects p ON c.project_id = p.id
            WHERE c.project_id = ANY(:project_ids)
              AND i.is_hidden = FALSE
              AND (i.is_verified = TRUE OR i.status = 'classified')
              {camera_clause}
        ),
        categorized AS (
            SELECT
                (
                    (s.is_verified AND EXISTS (
                        SELECT 1 FROM human_observations ho
                        WHERE ho.image_id = s.id AND ho.species = 'person'
                    ))
                    OR
                    (NOT s.is_verified AND EXISTS (
                        SELECT 1 FROM detections d
                        WHERE d.image_id = s.id
                          AND d.category = 'person'
                          AND d.confidence >= s.detection_threshold
                    ))
                ) AS has_person,
                (
                    (s.is_verified AND EXISTS (
                        SELECT 1 FROM human_observations ho
                        WHERE ho.image_id = s.id AND ho.species = 'vehicle'
                    ))
                    OR
                    (NOT s.is_verified AND EXISTS (
                        SELECT 1 FROM detections d
                        WHERE d.image_id = s.id
                          AND d.category = 'vehicle'
                          AND d.confidence >= s.detection_threshold
                    ))
                ) AS has_vehicle,
                (
                    (s.is_verified AND EXISTS (
                        SELECT 1 FROM human_observations ho
                        WHERE ho.image_id = s.id
                          AND ho.species NOT IN ('person', 'vehicle')
                    ))
                    OR
                    (NOT s.is_verified AND EXISTS (
                        SELECT 1 FROM detections d
                        JOIN classifications cl ON cl.detection_id = d.id
                        WHERE d.image_id = s.id
                          AND d.category = 'animal'
                          AND d.confidence >= s.detection_threshold
                          AND cl.confidence >= COALESCE(
                              (s.classification_thresholds->'overrides'->>cl.species)::float,
                              (s.classification_thresholds->>'default')::float,
                              0.0
                          )
                    ))
                ) AS has_animal
            FROM scope s
        )
        SELECT
            COALESCE(SUM(CASE WHEN has_person THEN 1 ELSE 0 END), 0) AS person_count,
            COALESCE(SUM(CASE WHEN NOT has_person AND has_vehicle THEN 1 ELSE 0 END), 0) AS vehicle_count,
            COALESCE(SUM(CASE WHEN NOT has_person AND NOT has_vehicle AND has_animal THEN 1 ELSE 0 END), 0) AS animal_count,
            COALESCE(SUM(CASE WHEN NOT has_person AND NOT has_vehicle AND NOT has_animal THEN 1 ELSE 0 END), 0) AS empty_count
        FROM categorized
    """)
    category_params: Dict[str, Any] = {"project_ids": accessible_project_ids}
    if camera_id_list:
        category_params["camera_ids"] = camera_id_list
    category_row = (await db.execute(category_sql, category_params)).one()

    return PipelineStatusResponse(
        pending=pending,
        classified=classified,
        total_images=pending + classified,
        person_count=int(category_row.person_count or 0),
        vehicle_count=int(category_row.vehicle_count or 0),
        animal_count=int(category_row.animal_count or 0),
        empty_count=int(category_row.empty_count or 0),
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

    # Unverified: AI classifications above threshold, grouped by species.
    # The Project join is needed so classification_passes_threshold() can read
    # the per-species classification_thresholds dict.
    unverified_query = (
        select(
            Classification.species.label('species'),
            func.count(Classification.id).label('count'),
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Image.is_verified == False,
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= threshold,
                classification_passes_threshold(),
            )
        )
        .group_by(Classification.species)
    )

    # Person/vehicle: detections above threshold, grouped by category
    pv_query = (
        select(
            Detection.category.label('species'),
            func.count(Detection.id).label('count'),
        )
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.is_verified == False,
                Camera.project_id.in_(accessible_project_ids),
                Detection.category.in_(['person', 'vehicle']),
                Detection.confidence >= threshold,
            )
        )
        .group_by(Detection.category)
    )

    # Combine and sum per species
    from sqlalchemy import union_all
    combined = union_all(verified_query, unverified_query, pv_query).subquery()
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
    independent_event_count: int


class IndependenceSummaryResponse(BaseModel):
    raw_total: int
    independent_total: int
    independent_event_total: int
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
            independent_event_total=0,
            species=[],
        )

    # Get raw counts (no independence filtering)
    raw_counts = await get_preferred_species_counts(
        db=db,
        project_ids=accessible_project_ids,
    )

    # Get independence-filtered counts (sum of MaxN per event) and event counts
    indep_counts = await get_independent_species_counts(
        db=db,
        project_ids=accessible_project_ids,
        interval_minutes=interval,
    )
    event_counts = await get_independent_event_counts(
        db=db,
        project_ids=accessible_project_ids,
        interval_minutes=interval,
    )

    # Build lookups
    indep_lookup = {c['species']: c['count'] for c in indep_counts}
    event_lookup = {c['species']: c['count'] for c in event_counts}

    # Merge: use raw species list as base (it has all species)
    species_list = []
    raw_total = 0
    indep_total = 0
    event_total = 0
    for rc in raw_counts:
        sp = rc['species']
        raw_c = rc['count']
        indep_c = indep_lookup.get(sp, 0)
        event_c = event_lookup.get(sp, 0)
        raw_total += raw_c
        indep_total += indep_c
        event_total += event_c
        species_list.append(IndependenceSummarySpecies(
            species=sp,
            raw_count=raw_c,
            independent_count=indep_c,
            independent_event_count=event_c,
        ))

    return IndependenceSummaryResponse(
        raw_total=raw_total,
        independent_total=indep_total,
        independent_event_total=event_total,
        species=species_list,
    )


# ==================== Demographics ====================


class DemographicValue(BaseModel):
    value: str
    count: int


class DemographicResponse(BaseModel):
    field: str
    species: Optional[str] = None
    values: List[DemographicValue]
    total: int


@router.get(
    "/demographics",
    response_model=DemographicResponse,
)
async def get_demographics(
    project_id: Optional[int] = Query(None),
    field: str = Query("sex", description="'sex' or 'life_stage'"),
    species: Optional[str] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    camera_ids: Optional[str] = Query(None),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get sex or life_stage distribution from verified human observations.

    Only counts verified observations because sex and life_stage are
    human-entered data (the AI does not predict them).
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    if field not in ("sex", "life_stage", "behavior"):
        from fastapi import HTTPException, status as http_status
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="field must be 'sex', 'life_stage', or 'behavior'",
        )

    # Pick the column to group by
    group_col = (
        HumanObservation.sex if field == "sex"
        else HumanObservation.life_stage if field == "life_stage"
        else HumanObservation.behavior
    )

    filters = [
        Camera.project_id.in_(accessible_project_ids),
        Image.is_verified == True,
        Image.is_hidden == False,
    ]
    if species:
        filters.append(func.lower(HumanObservation.species) == species.lower())
    if start_date:
        filters.append(Image.captured_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        filters.append(Image.captured_at <= datetime.combine(end_date, datetime.max.time()))
    if camera_ids:
        camera_id_list = [int(x.strip()) for x in camera_ids.split(",") if x.strip()]
        filters.append(Image.camera_id.in_(camera_id_list))

    query = (
        select(group_col, func.sum(HumanObservation.count).label("total"))
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*filters))
        .group_by(group_col)
        .order_by(func.sum(HumanObservation.count).desc())
    )

    result = await db.execute(query)
    rows = result.all()

    values = [DemographicValue(value=row[0] or "unknown", count=row[1]) for row in rows]
    total = sum(v.count for v in values)

    return DemographicResponse(
        field=field,
        species=species,
        values=values,
        total=total,
    )


# ==================== Verification Progress ====================


class VerificationProgressResponse(BaseModel):
    total: int
    verified: int
    percentage: float
    label: str


@router.get(
    "/verification-progress",
    response_model=VerificationProgressResponse,
)
async def get_verification_progress(
    project_id: Optional[int] = Query(None),
    label: Optional[str] = Query(None, description="Filter: 'all', 'empty', 'person', 'vehicle', or a species name"),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    camera_ids: Optional[str] = Query(None),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get verification progress (verified / total images) with optional label filter.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    camera_id_list = [int(x.strip()) for x in camera_ids.split(",") if x.strip()] if camera_ids else None

    base_filters: list = [
        Camera.project_id.in_(accessible_project_ids),
        Image.is_hidden == False,
        Image.status == "classified",
    ]
    if start_date:
        base_filters.append(Image.captured_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        base_filters.append(Image.captured_at <= datetime.combine(end_date, datetime.max.time()))
    if camera_id_list:
        base_filters.append(Image.camera_id.in_(camera_id_list))

    effective_label = label or "all"

    # Label-specific subquery filter (narrows the image set)
    label_filter = None
    if effective_label == "empty":
        # Images with no visible detections AND no human observations
        has_vis_pv = (
            select(Detection.image_id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(Detection.confidence >= Project.detection_threshold, Detection.category.in_(["person", "vehicle"]))
            .distinct()
        )
        has_vis_animal = (
            select(Detection.image_id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .join(Classification, Classification.detection_id == Detection.id)
            .where(Detection.confidence >= Project.detection_threshold, Detection.category == "animal", classification_passes_threshold())
            .distinct()
        )
        has_human_obs = select(HumanObservation.image_id).distinct()
        label_filter = and_(
            ~Image.id.in_(has_vis_pv),
            ~Image.id.in_(has_vis_animal),
            ~Image.id.in_(has_human_obs),
        )
    elif effective_label in ("person", "vehicle"):
        label_filter = Image.id.in_(
            select(Detection.image_id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                Detection.category == effective_label,
                Detection.confidence >= Project.detection_threshold,
            )
            .distinct()
        )
    elif effective_label != "all":
        # Species name filter
        from sqlalchemy import or_ as sa_or
        label_filter = sa_or(
            # Unverified: AI classification
            and_(
                Image.is_verified == False,
                Image.id.in_(
                    select(Image.id)
                    .join(Detection)
                    .join(Classification)
                    .join(Camera, Image.camera_id == Camera.id)
                    .join(Project, Camera.project_id == Project.id)
                    .where(
                        func.lower(Classification.species) == effective_label.lower(),
                        Detection.confidence >= Project.detection_threshold,
                        classification_passes_threshold(),
                    )
                ),
            ),
            # Verified: human observation
            and_(
                Image.is_verified == True,
                Image.id.in_(
                    select(Image.id)
                    .join(HumanObservation)
                    .where(func.lower(HumanObservation.species) == effective_label.lower())
                ),
            ),
        )

    # Count total
    total_q = select(func.count(Image.id)).join(Camera).where(and_(*base_filters))
    if label_filter is not None:
        total_q = total_q.where(label_filter)
    total = (await db.execute(total_q)).scalar_one()

    # Count verified
    verified_q = (
        select(func.count(Image.id))
        .join(Camera)
        .where(and_(*base_filters, Image.is_verified == True))
    )
    if label_filter is not None:
        verified_q = verified_q.where(label_filter)
    verified = (await db.execute(verified_q)).scalar_one()

    percentage = round((verified / total) * 100) if total > 0 else 0.0

    return VerificationProgressResponse(
        total=total,
        verified=verified,
        percentage=percentage,
        label=effective_label,
    )


class VerificationProgressAllResponse(BaseModel):
    rows: List[VerificationProgressResponse]


@router.get(
    "/verification-progress-all",
    response_model=VerificationProgressAllResponse,
)
async def get_verification_progress_all(
    project_id: Optional[int] = Query(None),
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    camera_ids: Optional[str] = Query(None),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get verification progress for ALL labels in a single call.

    Returns one row per observed species (plus "all") sorted by percentage
    ascending so the least-verified labels appear first.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)
    camera_id_list = [int(x.strip()) for x in camera_ids.split(",") if x.strip()] if camera_ids else None

    base_filters: list = [
        Camera.project_id.in_(accessible_project_ids),
        Image.is_hidden == False,
        Image.status == "classified",
    ]
    if start_date:
        base_filters.append(Image.captured_at >= datetime.combine(start_date, datetime.min.time()))
    if end_date:
        base_filters.append(Image.captured_at <= datetime.combine(end_date, datetime.max.time()))
    if camera_id_list:
        base_filters.append(Image.camera_id.in_(camera_id_list))

    # "All images" totals
    total_all = (await db.execute(
        select(func.count(Image.id)).join(Camera).where(and_(*base_filters))
    )).scalar_one()
    verified_all = (await db.execute(
        select(func.count(Image.id)).join(Camera).where(and_(*base_filters, Image.is_verified == True))
    )).scalar_one()

    rows = [VerificationProgressResponse(
        total=total_all,
        verified=verified_all,
        percentage=round((verified_all / total_all) * 100) if total_all > 0 else 0.0,
        label="all",
    )]

    # Per-species: count verified vs total per species using the
    # "preferred" data source (human obs for verified, classification
    # for unverified). For simplicity, count images that have at least
    # one detection/observation of each species.
    species_q = (
        select(
            HumanObservation.species,
            func.count(func.distinct(Image.id)).label("total"),
            func.count(func.distinct(Image.id)).filter(Image.is_verified == True).label("verified"),
        )
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(
            Camera.project_id.in_(accessible_project_ids),
            Image.is_hidden == False,
        ))
        .group_by(HumanObservation.species)
    )
    species_result = await db.execute(species_q)
    for row in species_result.all():
        sp_total = row.total
        sp_verified = row.verified
        rows.append(VerificationProgressResponse(
            total=sp_total,
            verified=sp_verified,
            percentage=round((sp_verified / sp_total) * 100) if sp_total > 0 else 0.0,
            label=row.species,
        ))

    # Person and Vehicle rows: images with at least one detection of that category
    for category in ["person", "vehicle"]:
        cat_subq = (
            select(func.distinct(Detection.image_id))
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                Detection.category == category,
                Detection.confidence >= Project.detection_threshold,
                Camera.project_id.in_(accessible_project_ids),
                Image.is_hidden == False,
            )
        )
        cat_filter = Image.id.in_(cat_subq)
        cat_total = (await db.execute(
            select(func.count(Image.id)).join(Camera).where(and_(*base_filters, cat_filter))
        )).scalar_one()
        cat_verified = (await db.execute(
            select(func.count(Image.id)).join(Camera).where(and_(*base_filters, cat_filter, Image.is_verified == True))
        )).scalar_one()
        if cat_total > 0:
            rows.append(VerificationProgressResponse(
                total=cat_total,
                verified=cat_verified,
                percentage=round((cat_verified / cat_total) * 100) if cat_total > 0 else 0.0,
                label=category,
            ))

    # "Empty" row: images with no visible detections and no human observations
    has_vis_pv = (
        select(Detection.image_id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(Detection.confidence >= Project.detection_threshold, Detection.category.in_(["person", "vehicle"]))
        .distinct()
    )
    has_vis_animal = (
        select(Detection.image_id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .join(Classification, Classification.detection_id == Detection.id)
        .where(Detection.confidence >= Project.detection_threshold, Detection.category == "animal", classification_passes_threshold())
        .distinct()
    )
    has_human_obs = select(HumanObservation.image_id).distinct()
    empty_filter = and_(
        ~Image.id.in_(has_vis_pv),
        ~Image.id.in_(has_vis_animal),
        ~Image.id.in_(has_human_obs),
    )
    empty_total = (await db.execute(
        select(func.count(Image.id)).join(Camera).where(and_(*base_filters, empty_filter))
    )).scalar_one()
    empty_verified = (await db.execute(
        select(func.count(Image.id)).join(Camera).where(and_(*base_filters, empty_filter, Image.is_verified == True))
    )).scalar_one()
    if empty_total > 0:
        rows.append(VerificationProgressResponse(
            total=empty_total,
            verified=empty_verified,
            percentage=round((empty_verified / empty_total) * 100) if empty_total > 0 else 0.0,
            label="empty",
        ))

    # Sort by total images descending (most images first), keep "all" pinned at top
    all_row = rows[0]
    rest = sorted(rows[1:], key=lambda r: r.total, reverse=True)
    rows = [all_row] + rest

    return VerificationProgressAllResponse(rows=rows)


class PerformanceAggregateRow(BaseModel):
    """Per-species instance-level comparison between human and AI counts"""
    species: str
    human_count: int
    ai_count: int
    diff: int  # ai_count - human_count, negative means AI under-counts


class PerformanceResponse(BaseModel):
    """Performance data for a project: aggregate + confusion matrix"""
    total_verified_images: int
    aggregate: List[PerformanceAggregateRow]
    matrix_classes: List[str]
    matrix: List[List[int]]
    matrix_row_totals: List[int]
    matrix_col_totals: List[int]
    matrix_correct: int
    matrix_accuracy: float


@router.get("/performance", response_model=PerformanceResponse)
async def get_performance(
    project_id: int = Query(..., description="Project to compute performance for"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Compare AI predictions against human verifications for a project.

    Returns two views computed in a single pass over the verified images:

    - Aggregate per-species instance counts (sum of human observation counts
      vs count of visible AI detections). Good for spotting per-species bias.
    - Image-level top-1 confusion matrix, including empty/person/vehicle as
      classes. Good for spotting which species the AI confuses for which.

    Both views honor the project's detection and classification thresholds
    so the comparison matches what the user sees in the rest of the UI.
    """
    if project_id not in accessible_project_ids:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this project",
        )

    # Load project for per-species classification thresholds.
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        from fastapi import HTTPException, status as http_status
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"Project {project_id} not found",
        )

    # Fetch verified, classified, non-hidden images for this project with
    # their detections and human observations eagerly loaded. One query.
    query = (
        select(Image)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            Camera.project_id == project_id,
            Image.is_verified == True,
            Image.status == "classified",
            Image.is_hidden == False,
        )
        .options(
            selectinload(Image.human_observations),
            selectinload(Image.detections).selectinload(Detection.classifications),
        )
    )
    result = await db.execute(query)
    images = result.scalars().unique().all()

    from collections import Counter
    human_counts: Counter = Counter()  # aggregate: human instances by species
    ai_counts: Counter = Counter()     # aggregate: AI instances by species
    matrix_counts: Counter = Counter() # matrix: (gt, pred) -> count

    for image in images:
        # ----- Aggregate: human side (instance-level) -----
        # Sum HumanObservation.count for every observation row on this image.
        for obs in image.human_observations:
            human_counts[obs.species] += obs.count

        # Collect visible detections with their effective label.
        # "Visible" = passes detection_threshold AND (for animals) passes the
        # per-species classification_threshold. Mirrors images.py:598-610.
        visible_labeled: list[tuple[str, float]] = []  # (label, classification_confidence)
        visible_pv: list[tuple[str, float]] = []  # (category, detection_confidence)
        for d in image.detections:
            if d.confidence < project.detection_threshold:
                continue
            if d.category in ("person", "vehicle"):
                visible_pv.append((d.category, d.confidence))
                ai_counts[d.category] += 1
            elif d.category == "animal" and d.classifications:
                cls = d.classifications[0]
                cls_thresh = effective_classification_threshold(
                    project.classification_thresholds, cls.species,
                )
                if cls.confidence < cls_thresh:
                    continue
                visible_labeled.append((cls.species, cls.confidence))
                ai_counts[cls.species] += 1

        # ----- Matrix: image-level top-1 pairing -----
        # Human top-1: highest-count observation, first-seen on ties.
        if image.human_observations:
            sorted_obs = sorted(
                image.human_observations,
                key=lambda o: o.count,
                reverse=True,
            )
            human_top = sorted_obs[0].species
        else:
            human_top = "empty"

        # AI top-1: person/vehicle take precedence if present (they're
        # what the UI shows on the grid card), otherwise highest-confidence
        # visible animal classification. Empty if no visible detections.
        if visible_pv:
            ai_top = max(visible_pv, key=lambda x: x[1])[0]
        elif visible_labeled:
            ai_top = max(visible_labeled, key=lambda x: x[1])[0]
        else:
            ai_top = "empty"

        matrix_counts[(human_top, ai_top)] += 1

    # Build aggregate rows, sorted by max(human, ai) descending so the most
    # prominent species sit at the top of the table.
    all_species = set(human_counts) | set(ai_counts)
    aggregate_rows = [
        PerformanceAggregateRow(
            species=species,
            human_count=human_counts.get(species, 0),
            ai_count=ai_counts.get(species, 0),
            diff=ai_counts.get(species, 0) - human_counts.get(species, 0),
        )
        for species in all_species
    ]
    aggregate_rows.sort(
        key=lambda r: max(r.human_count, r.ai_count),
        reverse=True,
    )

    # Build matrix class list: empty, person, vehicle first (guaranteed
    # present even if zero), then species alphabetical.
    seen_classes = {gt for gt, _ in matrix_counts} | {pred for _, pred in matrix_counts}
    fixed_head = ["empty", "person", "vehicle"]
    species_classes = sorted(seen_classes - set(fixed_head))
    matrix_classes = fixed_head + species_classes

    class_index = {c: i for i, c in enumerate(matrix_classes)}
    n = len(matrix_classes)
    matrix = [[0] * n for _ in range(n)]
    for (gt, pred), count in matrix_counts.items():
        matrix[class_index[gt]][class_index[pred]] = count

    row_totals = [sum(row) for row in matrix]
    col_totals = [sum(matrix[r][c] for r in range(n)) for c in range(n)]
    matrix_correct = sum(matrix[i][i] for i in range(n))
    total_pairs = sum(row_totals)
    matrix_accuracy = (matrix_correct / total_pairs) if total_pairs > 0 else 0.0

    return PerformanceResponse(
        total_verified_images=len(images),
        aggregate=aggregate_rows,
        matrix_classes=matrix_classes,
        matrix=matrix,
        matrix_row_totals=row_totals,
        matrix_col_totals=col_totals,
        matrix_correct=matrix_correct,
        matrix_accuracy=matrix_accuracy,
    )
