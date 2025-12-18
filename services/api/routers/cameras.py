"""
Camera endpoints for viewing camera trap devices and their health status.
"""
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Camera
from shared.database import get_async_session
from auth.users import current_active_user


router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraResponse(BaseModel):
    """Camera response with health status"""
    id: int
    name: str
    location: Optional[dict] = None  # {lat, lon}
    battery_percentage: Optional[int] = None
    temperature: Optional[int] = None
    signal_quality: Optional[int] = None
    sd_utilization_percentage: Optional[float] = None
    last_report_timestamp: Optional[str] = None
    status: str  # active, inactive, never_reported
    total_images: Optional[int] = None
    sent_images: Optional[int] = None

    class Config:
        from_attributes = True


def parse_camera_status(camera: Camera) -> str:
    """
    Determine camera status based on last report timestamp

    Args:
        camera: Camera model instance

    Returns:
        Status string: 'active', 'inactive', or 'never_reported'
    """
    if not camera.config or 'last_report_timestamp' not in camera.config:
        return 'never_reported'

    last_report_str = camera.config.get('last_report_timestamp')
    if not last_report_str:
        return 'never_reported'

    try:
        last_report = datetime.fromisoformat(last_report_str)
        days_since_report = (datetime.utcnow() - last_report).days

        if days_since_report <= 7:
            return 'active'
        else:
            return 'inactive'
    except (ValueError, TypeError):
        return 'never_reported'


def camera_to_response(camera: Camera) -> CameraResponse:
    """
    Convert Camera model to CameraResponse

    Args:
        camera: Camera model instance

    Returns:
        CameraResponse with parsed health data
    """
    health_data = camera.config.get('last_health_report', {}) if camera.config else {}
    gps_data = camera.config.get('gps_from_report') if camera.config else None

    return CameraResponse(
        id=camera.id,
        name=camera.name,
        location=gps_data,
        battery_percentage=health_data.get('battery_percentage'),
        temperature=health_data.get('temperature'),
        signal_quality=health_data.get('signal_quality'),
        sd_utilization_percentage=health_data.get('sd_utilization_percentage'),
        last_report_timestamp=camera.config.get('last_report_timestamp') if camera.config else None,
        status=parse_camera_status(camera),
        total_images=health_data.get('total_images'),
        sent_images=health_data.get('sent_images'),
    )


@router.get(
    "",
    response_model=List[CameraResponse],
)
async def list_cameras(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    List all cameras with health status

    Args:
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of cameras with health data
    """
    result = await db.execute(select(Camera))
    cameras = result.scalars().all()

    return [camera_to_response(camera) for camera in cameras]


@router.get(
    "/{camera_id}",
    response_model=CameraResponse,
)
async def get_camera(
    camera_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get single camera by ID

    Args:
        camera_id: Camera ID
        db: Database session
        current_user: Current authenticated user

    Returns:
        Camera with health data

    Raises:
        HTTPException: If camera not found
    """
    result = await db.execute(
        select(Camera).where(Camera.id == camera_id)
    )
    camera = result.scalar_one_or_none()

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Camera not found",
        )

    return camera_to_response(camera)
