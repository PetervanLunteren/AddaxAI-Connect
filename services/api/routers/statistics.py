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
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get images uploaded over time (last 30 days, filtered by accessible projects)

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of data points with date and count
    """
    # Calculate date range
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=30)

    # Query images grouped by date (filtered by project via camera)
    query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Image.id).label('count')
        )
        .join(Camera)
        .where(
            and_(
                Image.uploaded_at >= start_date,
                Camera.project_id.in_(accessible_project_ids)
            )
        )
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
