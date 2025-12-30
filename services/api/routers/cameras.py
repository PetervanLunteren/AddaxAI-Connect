"""
Camera endpoints for viewing camera trap devices and their health status.
"""
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Camera, Project
from shared.database import get_async_session
from auth.users import current_active_user, current_superuser


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


class CreateCameraRequest(BaseModel):
    """Request model for creating a new camera"""
    imei: str
    name: Optional[str] = None  # Display name (optional, defaults to IMEI)
    project_id: int


class UpdateCameraRequest(BaseModel):
    """Request model for updating camera"""
    name: Optional[str] = None
    notes: Optional[str] = None


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


@router.post(
    "",
    response_model=CameraResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_camera(
    request: CreateCameraRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Create a new camera (superuser only).

    Args:
        request: Camera creation data (IMEI required, name optional)
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Created camera

    Raises:
        HTTPException: If IMEI already exists or project not found
    """
    # Check if IMEI already exists
    result = await db.execute(
        select(Camera).where(Camera.imei == request.imei)
    )
    existing_camera = result.scalar_one_or_none()

    if existing_camera:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Camera with IMEI {request.imei} already exists",
        )

    # Verify project exists
    result = await db.execute(
        select(Project).where(Project.id == request.project_id)
    )
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {request.project_id} not found",
        )

    # Create camera
    camera = Camera(
        imei=request.imei,
        name=request.name if request.name else request.imei,  # Default name to IMEI
        project_id=request.project_id,
        status='inventory',
        config={}
    )

    db.add(camera)
    await db.commit()
    await db.refresh(camera)

    return camera_to_response(camera)


@router.put(
    "/{camera_id}",
    response_model=CameraResponse,
)
async def update_camera(
    camera_id: int,
    request: UpdateCameraRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Update camera metadata (superuser only).

    Args:
        camera_id: Camera ID
        request: Update data
        db: Database session
        current_user: Current authenticated superuser

    Returns:
        Updated camera

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

    # Update fields if provided
    if request.name is not None:
        camera.name = request.name
    if request.notes is not None:
        camera.notes = request.notes

    await db.commit()
    await db.refresh(camera)

    return camera_to_response(camera)


@router.delete(
    "/{camera_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_camera(
    camera_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Delete camera (superuser only).

    Args:
        camera_id: Camera ID
        db: Database session
        current_user: Current authenticated superuser

    Raises:
        HTTPException: If camera not found or has associated images
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

    # Check if camera has associated images
    if camera.images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete camera with {len(camera.images)} associated images. Delete images first.",
        )

    await db.delete(camera)
    await db.commit()
