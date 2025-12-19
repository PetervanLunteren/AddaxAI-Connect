"""
Statistics endpoints for dashboard metrics and charts.
"""
from typing import List
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification
from shared.database import get_async_session
from auth.users import current_active_user


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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get dashboard overview statistics

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        Overview statistics for dashboard
    """
    # Total images
    total_images_result = await db.execute(select(func.count(Image.id)))
    total_images = total_images_result.scalar_one()

    # Total cameras
    total_cameras_result = await db.execute(select(func.count(Camera.id)))
    total_cameras = total_cameras_result.scalar_one()

    # Total unique species
    total_species_result = await db.execute(
        select(func.count(func.distinct(Classification.species)))
    )
    total_species = total_species_result.scalar_one()

    # Images today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    images_today_result = await db.execute(
        select(func.count(Image.id)).where(Image.uploaded_at >= today_start)
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get images uploaded over time (last 30 days)

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of data points with date and count
    """
    # Calculate date range
    end_date = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    start_date = end_date - timedelta(days=30)

    # Query images grouped by date
    query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Image.id).label('count')
        )
        .where(Image.uploaded_at >= start_date)
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get species distribution (top 10)

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of species with counts (top 10 by count)
    """
    query = (
        select(
            Classification.species,
            func.count(Classification.id).label('count')
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get camera activity status summary

    Categorizes cameras as:
    - Active: Last report within 7 days
    - Inactive: Last report older than 7 days
    - Never Reported: No health report received

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        Camera activity counts by status
    """
    # Fetch all cameras
    result = await db.execute(select(Camera))
    cameras = result.scalars().all()

    active_count = 0
    inactive_count = 0
    never_reported_count = 0

    cutoff_date = datetime.utcnow() - timedelta(days=7)

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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get timestamp of most recently classified image

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        Last update timestamp or null if no images exist
    """
    # Query most recent classified image
    query = (
        select(Image.uploaded_at)
        .where(Image.status == "classified")
        .order_by(desc(Image.uploaded_at))
        .limit(1)
    )

    result = await db.execute(query)
    last_update = result.scalar_one_or_none()

    return LastUpdateResponse(
        last_update=last_update.isoformat() if last_update else None
    )
