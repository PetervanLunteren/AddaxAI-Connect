"""
Camera endpoints for viewing camera trap devices and their health status.
"""
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from pydantic import BaseModel

from shared.models import User, Camera, Project, Image, CameraHealthReport
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from auth.project_access import get_accessible_project_ids, narrow_to_project


router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraResponse(BaseModel):
    """Camera response with health status"""
    id: int
    name: str
    imei: Optional[str] = None
    custom_fields: Optional[dict] = None
    location: Optional[dict] = None  # {lat, lon}
    battery_percentage: Optional[int] = None
    temperature: Optional[int] = None
    signal_quality: Optional[int] = None
    sd_utilization_percentage: Optional[float] = None
    last_report_timestamp: Optional[str] = None
    last_image_timestamp: Optional[str] = None
    status: str  # active, inactive, never_reported
    total_images: Optional[int] = None
    sent_images: Optional[int] = None

    class Config:
        from_attributes = True


class CreateCameraRequest(BaseModel):
    """Request model for creating a new camera"""
    imei: str
    friendly_name: Optional[str] = None  # Display name (optional, defaults to IMEI)
    custom_fields: Optional[dict] = None
    project_id: int


class UpdateCameraRequest(BaseModel):
    """Request model for updating camera"""
    friendly_name: Optional[str] = None
    custom_fields: Optional[dict] = None
    notes: Optional[str] = None


class CameraImportRow(BaseModel):
    """Result for a single CSV import row"""
    row_number: int
    imei: str
    success: bool
    error: Optional[str] = None
    camera_id: Optional[int] = None


class BulkImportResponse(BaseModel):
    """Response model for CSV bulk import"""
    success_count: int
    failed_count: int
    results: List[CameraImportRow]


class HealthReportPoint(BaseModel):
    """Single health report data point"""
    date: str  # YYYY-MM-DD
    battery_percent: Optional[int] = None
    signal_quality: Optional[int] = None
    temperature_c: Optional[int] = None
    sd_utilization_percent: Optional[float] = None
    total_images: Optional[int] = None
    sent_images: Optional[int] = None

    class Config:
        from_attributes = True


class HealthHistoryResponse(BaseModel):
    """Camera health history response"""
    camera_id: int
    camera_name: str
    reports: List[HealthReportPoint]


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
        days_since_report = (datetime.now(timezone.utc) - last_report).days

        if days_since_report <= 7:
            return 'active'
        else:
            return 'inactive'
    except (ValueError, TypeError):
        return 'never_reported'


def camera_to_response(camera: Camera, last_image_timestamp: Optional[datetime] = None) -> CameraResponse:
    """
    Convert Camera model to CameraResponse

    Args:
        camera: Camera model instance
        last_image_timestamp: Optional timestamp of the most recent image

    Returns:
        CameraResponse with parsed health data
    """
    health_data = camera.config.get('last_health_report', {}) if camera.config else {}
    gps_data = camera.config.get('gps_from_report') if camera.config else None

    return CameraResponse(
        id=camera.id,
        name=camera.name,
        imei=camera.imei,
        custom_fields=camera.custom_fields,
        location=gps_data,
        battery_percentage=health_data.get('battery_percentage'),
        signal_quality=health_data.get('signal_quality'),
        sd_utilization_percentage=health_data.get('sd_utilization_percentage'),
        last_report_timestamp=camera.config.get('last_report_timestamp') if camera.config else None,
        last_image_timestamp=last_image_timestamp.isoformat() if last_image_timestamp else None,
        status=parse_camera_status(camera),
        total_images=health_data.get('total_images'),
        sent_images=health_data.get('sent_images'),
    )


@router.get(
    "",
    response_model=List[CameraResponse],
)
async def list_cameras(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    List all cameras with health status

    Returns cameras filtered by user's accessible projects:
    - Server admins: all cameras
    - Regular users: only cameras from their assigned projects

    Args:
        project_id: Optional project ID to filter to
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of cameras with health data
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    # Filter cameras by accessible projects
    query = select(Camera).where(Camera.project_id.in_(accessible_project_ids))
    result = await db.execute(query)
    cameras = result.scalars().all()

    # Get last image timestamp for each camera
    camera_ids = [c.id for c in cameras]
    if camera_ids:
        last_image_query = (
            select(Image.camera_id, func.max(Image.uploaded_at).label('last_uploaded'))
            .where(Image.camera_id.in_(camera_ids))
            .group_by(Image.camera_id)
        )
        last_image_result = await db.execute(last_image_query)
        last_image_map = {row.camera_id: row.last_uploaded for row in last_image_result}
    else:
        last_image_map = {}

    return [camera_to_response(camera, last_image_map.get(camera.id)) for camera in cameras]


@router.get(
    "/{camera_id}",
    response_model=CameraResponse,
)
async def get_camera(
    camera_id: int,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get single camera by ID

    Args:
        camera_id: Camera ID
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Camera with health data

    Raises:
        HTTPException: If camera not found or not accessible
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

    # Check if user has access to this camera's project
    if camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this camera"
        )

    # Get last image timestamp
    last_image_query = (
        select(func.max(Image.uploaded_at))
        .where(Image.camera_id == camera_id)
    )
    last_image_result = await db.execute(last_image_query)
    last_image_timestamp = last_image_result.scalar_one_or_none()

    return camera_to_response(camera, last_image_timestamp)


@router.get(
    "/{camera_id}/health-history",
    response_model=HealthHistoryResponse,
)
async def get_camera_health_history(
    camera_id: int,
    days: int = Query(30, ge=1, le=365, description="Number of days to look back (1-365)"),
    start_date: Optional[date] = Query(None, description="Start date (overrides days if provided)"),
    end_date: Optional[date] = Query(None, description="End date (defaults to today)"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get historical health reports for a camera.

    Returns daily health metrics over the specified time range.
    Supports preset ranges (7/30/90 days) via `days` parameter,
    or custom ranges via start_date/end_date.

    Args:
        camera_id: Camera ID
        days: Number of days to look back (default 30, max 365)
        start_date: Custom start date (YYYY-MM-DD)
        end_date: Custom end date (YYYY-MM-DD, defaults to today)
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Health history with daily data points

    Raises:
        HTTPException: If camera not found or not accessible
    """
    # Get camera and verify access
    result = await db.execute(
        select(Camera).where(Camera.id == camera_id)
    )
    camera = result.scalar_one_or_none()

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Camera not found",
        )

    if camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this camera"
        )

    # Calculate date range
    if end_date is None:
        end_date = date.today()

    if start_date is None:
        start_date = end_date - timedelta(days=days)

    # Query health reports
    query = (
        select(CameraHealthReport)
        .where(
            and_(
                CameraHealthReport.camera_id == camera_id,
                CameraHealthReport.report_date >= start_date,
                CameraHealthReport.report_date <= end_date,
            )
        )
        .order_by(CameraHealthReport.report_date)
    )

    result = await db.execute(query)
    reports = result.scalars().all()

    # Convert to response format
    report_points = [
        HealthReportPoint(
            date=report.report_date.isoformat(),
            battery_percent=report.battery_percent,
            signal_quality=report.signal_quality,
            temperature_c=report.temperature_c,
            sd_utilization_percent=report.sd_utilization_percent,
            total_images=report.total_images,
            sent_images=report.sent_images,
        )
        for report in reports
    ]

    return HealthHistoryResponse(
        camera_id=camera_id,
        camera_name=camera.name,
        reports=report_points,
    )


@router.post(
    "",
    response_model=CameraResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_camera(
    request: CreateCameraRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Create a new camera (project admin or server admin)

    Args:
        request: Camera creation data (IMEI required, name optional)
        db: Database session
        current_user: Current authenticated user

    Returns:
        Created camera

    Raises:
        HTTPException: If IMEI already exists, project not found, or insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, request.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {request.project_id}",
        )

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
        name=request.friendly_name if request.friendly_name else request.imei,  # Default name to IMEI
        custom_fields=request.custom_fields or {},
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
    current_user: User = Depends(current_verified_user),
):
    """
    Update camera metadata (project admin or server admin)

    Args:
        camera_id: Camera ID
        request: Update data
        db: Database session
        current_user: Current authenticated user

    Returns:
        Updated camera

    Raises:
        HTTPException: If camera not found or insufficient permissions
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

    # Check project admin access
    if not await can_admin_project(current_user, camera.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {camera.project_id}",
        )

    # Update fields if provided
    if request.friendly_name is not None:
        camera.name = request.friendly_name
    if request.custom_fields is not None:
        camera.custom_fields = request.custom_fields
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
    current_user: User = Depends(current_verified_user),
):
    """
    Delete camera (project admin or server admin)

    Args:
        camera_id: Camera ID
        db: Database session
        current_user: Current authenticated user

    Raises:
        HTTPException: If camera not found, has associated images, or insufficient permissions
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

    # Check project admin access
    if not await can_admin_project(current_user, camera.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {camera.project_id}",
        )

    # Check if camera has associated images
    if camera.images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot delete camera with {len(camera.images)} associated images. Delete images first.",
        )

    await db.delete(camera)
    await db.commit()


@router.post(
    "/import-csv",
    response_model=BulkImportResponse,
    status_code=status.HTTP_200_OK,
)
async def import_cameras_csv(
    file: UploadFile = File(...),
    project_id: int = Form(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Bulk import cameras from CSV file (project admin or server admin)

    Expected CSV format with headers (delimiter auto-detected: comma or semicolon):
    Required: IMEI. Optional: FriendlyName. All other columns are stored as metadata.

    Args:
        file: CSV file upload
        project_id: Project ID to assign all cameras to (required)
        db: Database session
        current_user: Current authenticated user

    Returns:
        Import results with success/failure counts and per-row details

    Raises:
        HTTPException: If CSV format is invalid, project not found, or insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )
    # Verify file is CSV
    if not file.filename.endswith('.csv'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a CSV file",
        )

    # Read CSV content
    try:
        content = await file.read()
        csv_text = content.decode('utf-8-sig')  # utf-8-sig automatically removes BOM if present
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read CSV file: {str(e)}",
        )

    # Auto-detect delimiter (comma or semicolon)
    try:
        sniffer = csv.Sniffer()
        sample = csv_text[:1024]  # Use first 1024 chars for detection
        delimiter = sniffer.sniff(sample).delimiter
    except Exception:
        # Default to comma if detection fails
        delimiter = ','

    # Parse CSV
    try:
        csv_reader = csv.DictReader(io.StringIO(csv_text), delimiter=delimiter)
        rows = list(csv_reader)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to parse CSV: {str(e)}",
        )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV file is empty",
        )

    # Validate required headers
    actual_headers = set(rows[0].keys())

    if 'IMEI' not in actual_headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required CSV header: IMEI",
        )

    # Verify project exists
    result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found",
        )

    # Columns that are not stored in metadata
    reserved_columns = {'IMEI', 'FriendlyName'}

    # Process rows
    results: List[CameraImportRow] = []
    success_count = 0
    failed_count = 0

    for idx, row in enumerate(rows, start=2):  # Start at 2 (1 for header + 1-indexed)
        imei = (row.get('IMEI') or '').strip()

        # Validate IMEI is present
        if not imei:
            results.append(CameraImportRow(
                row_number=idx,
                imei='',
                success=False,
                error="IMEI is required"
            ))
            failed_count += 1
            continue

        # Check if IMEI already exists
        result = await db.execute(
            select(Camera).where(Camera.imei == imei)
        )
        existing_camera = result.scalar_one_or_none()

        if existing_camera:
            results.append(CameraImportRow(
                row_number=idx,
                imei=imei,
                success=False,
                error=f"Camera with IMEI {imei} already exists"
            ))
            failed_count += 1
            continue

        friendly_name = (row.get('FriendlyName') or '').strip() or None

        # Build custom_fields from all other columns
        custom_fields = {}
        for col_name, col_value in row.items():
            if col_name in reserved_columns:
                continue
            value = (col_value or '').strip()
            if value:
                custom_fields[col_name] = value

        # Create camera
        try:
            camera = Camera(
                imei=imei,
                name=friendly_name if friendly_name else imei,
                custom_fields=custom_fields if custom_fields else {},
                project_id=project_id,
                status='inventory',
                config={}
            )

            db.add(camera)
            await db.flush()  # Flush to get the ID

            results.append(CameraImportRow(
                row_number=idx,
                imei=imei,
                success=True,
                camera_id=camera.id
            ))
            success_count += 1

        except Exception as e:
            results.append(CameraImportRow(
                row_number=idx,
                imei=imei,
                success=False,
                error=f"Database error: {str(e)}"
            ))
            failed_count += 1
            continue

    # Commit all successful creates
    if success_count > 0:
        await db.commit()
    else:
        await db.rollback()

    return BulkImportResponse(
        success_count=success_count,
        failed_count=failed_count,
        results=results
    )
