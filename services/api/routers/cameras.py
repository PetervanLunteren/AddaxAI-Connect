"""
Camera endpoints for viewing camera trap devices and their health status.
"""
from typing import List, Optional
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete as sql_delete
from pydantic import BaseModel

from shared.models import User, Camera, Project, Image, CameraHealthReport, Detection, Classification
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from auth.project_access import get_accessible_project_ids, narrow_to_project
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraResponse(BaseModel):
    """Camera response with health status"""
    id: int
    name: str
    device_id: Optional[str] = None
    custom_fields: Optional[dict] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
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
    reference_image_url: Optional[str] = None
    reference_thumbnail_url: Optional[str] = None

    class Config:
        from_attributes = True


class CreateCameraRequest(BaseModel):
    """Request model for creating a new camera"""
    device_id: str
    friendly_name: Optional[str] = None  # Display name (optional, defaults to device ID)
    notes: Optional[str] = None
    custom_fields: Optional[dict] = None
    tags: Optional[List[str]] = None
    project_id: int


class UpdateCameraRequest(BaseModel):
    """Request model for updating camera"""
    friendly_name: Optional[str] = None
    custom_fields: Optional[dict] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None


class CameraImportRow(BaseModel):
    """Result for a single CSV import row"""
    row_number: int
    device_id: str
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


def normalize_tags(tags: Optional[List[str]]) -> List[str]:
    """Normalize tags: lowercase, strip, deduplicate, remove empties and commas."""
    if not tags:
        return []
    seen = set()
    result = []
    for tag in tags:
        tag = tag.strip().lower().replace(',', '')
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return result


def _camera_status(last_reported_at: Optional[datetime]) -> str:
    """
    Classify a camera as 'active', 'inactive' or 'never_reported' based on when its
    most recent health report arrived. A few-hour drift from the true local-vs-UTC
    offset is irrelevant for a 7-day window, so the cutoff is computed naive.
    """
    if last_reported_at is None:
        return 'never_reported'
    cutoff = datetime.utcnow() - timedelta(days=7)
    return 'active' if last_reported_at >= cutoff else 'inactive'


def _localize(dt: Optional[datetime], tz: ZoneInfo) -> Optional[str]:
    """Localize a naive camera-clock datetime under the server tz and return ISO 8601."""
    if dt is None:
        return None
    return dt.replace(tzinfo=tz).isoformat()


def camera_to_response(
    camera: Camera,
    tz: ZoneInfo,
    last_captured_at: Optional[datetime] = None,
    last_reported_at: Optional[datetime] = None,
) -> CameraResponse:
    """Convert a Camera model to the API response shape."""
    health_data = camera.config.get('last_health_report', {}) if camera.config else {}
    gps_data = camera.config.get('gps_from_report') if camera.config else None

    return CameraResponse(
        id=camera.id,
        name=camera.name,
        device_id=camera.device_id,
        custom_fields=camera.custom_fields,
        tags=camera.tags or [],
        notes=camera.notes,
        location=gps_data,
        battery_percentage=health_data.get('battery_percentage'),
        signal_quality=health_data.get('signal_quality'),
        sd_utilization_percentage=health_data.get('sd_utilization_percentage'),
        last_report_timestamp=_localize(last_reported_at, tz),
        last_image_timestamp=_localize(last_captured_at, tz),
        status=_camera_status(last_reported_at),
        total_images=health_data.get('total_images'),
        sent_images=health_data.get('sent_images'),
        reference_image_url=f"/reference-images/{camera.reference_image_path}" if camera.reference_image_path else None,
        reference_thumbnail_url=f"/reference-images/{camera.reference_thumbnail_path}" if camera.reference_thumbnail_path else None,
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

    camera_ids = [c.id for c in cameras]
    last_captured_map: dict[int, datetime] = {}
    last_reported_map: dict[int, datetime] = {}
    if camera_ids:
        captured_rows = await db.execute(
            select(Image.camera_id, func.max(Image.captured_at))
            .where(Image.camera_id.in_(camera_ids))
            .group_by(Image.camera_id)
        )
        last_captured_map = {cam_id: ts for cam_id, ts in captured_rows.all()}

        reported_rows = await db.execute(
            select(CameraHealthReport.camera_id, func.max(CameraHealthReport.reported_at))
            .where(CameraHealthReport.camera_id.in_(camera_ids))
            .group_by(CameraHealthReport.camera_id)
        )
        last_reported_map = {cam_id: ts for cam_id, ts in reported_rows.all()}

    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))

    return [
        camera_to_response(
            camera,
            tz=tz,
            last_captured_at=last_captured_map.get(camera.id),
            last_reported_at=last_reported_map.get(camera.id),
        )
        for camera in cameras
    ]


@router.get(
    "/tags",
    response_model=List[str],
)
async def get_camera_tags(
    project_id: Optional[int] = Query(None, description="Filter to a single project"),
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get all unique tags across cameras in accessible projects.

    Returns sorted list of unique tags for autocomplete.
    """
    accessible_project_ids = narrow_to_project(accessible_project_ids, project_id)

    result = await db.execute(
        select(Camera.tags).where(
            Camera.project_id.in_(accessible_project_ids),
            Camera.tags.isnot(None),
        )
    )

    all_tags = set()
    for (tags,) in result.all():
        if tags:
            for tag in tags:
                if tag and isinstance(tag, str):
                    all_tags.add(tag.strip().lower())

    return sorted(all_tags)


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

    last_captured_at = (await db.execute(
        select(func.max(Image.captured_at)).where(Image.camera_id == camera_id)
    )).scalar_one_or_none()

    last_reported_at = (await db.execute(
        select(func.max(CameraHealthReport.reported_at)).where(CameraHealthReport.camera_id == camera_id)
    )).scalar_one_or_none()

    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))

    return camera_to_response(
        camera,
        tz=tz,
        last_captured_at=last_captured_at,
        last_reported_at=last_reported_at,
    )


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

    # Query health reports. reported_at is naive camera-clock; clamp by its date component.
    query = (
        select(CameraHealthReport)
        .where(
            and_(
                CameraHealthReport.camera_id == camera_id,
                func.date(CameraHealthReport.reported_at) >= start_date,
                func.date(CameraHealthReport.reported_at) <= end_date,
            )
        )
        .order_by(CameraHealthReport.reported_at)
    )

    result = await db.execute(query)
    reports = result.scalars().all()

    # Convert to response format
    report_points = [
        HealthReportPoint(
            date=report.reported_at.date().isoformat(),
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
        request: Camera creation data (device_id required, name optional)
        db: Database session
        current_user: Current authenticated user

    Returns:
        Created camera

    Raises:
        HTTPException: If device_id already exists, project not found, or insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, request.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {request.project_id}",
        )

    # Check if device ID already exists
    result = await db.execute(
        select(Camera).where(Camera.device_id == request.device_id)
    )
    existing_camera = result.scalar_one_or_none()

    if existing_camera:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Camera with ID {request.device_id} already exists",
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
        device_id=request.device_id,
        name=request.friendly_name if request.friendly_name else request.device_id,  # Default name to device ID
        notes=request.notes or '',
        custom_fields=request.custom_fields or {},
        tags=normalize_tags(request.tags) if request.tags else [],
        project_id=request.project_id,
        status='inventory',
        config={}
    )

    db.add(camera)
    await db.commit()
    await db.refresh(camera)

    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return camera_to_response(camera, tz=tz)


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
    if request.tags is not None:
        camera.tags = normalize_tags(request.tags)

    await db.commit()
    await db.refresh(camera)

    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))
    return camera_to_response(camera, tz=tz)


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

    # Cascade delete all associated data
    camera_device_id = camera.device_id or str(camera.id)

    images_query = select(Image).where(Image.camera_id == camera.id)
    images_result = await db.execute(images_query)
    images = images_result.scalars().all()

    for image in images:
        detections_query = select(Detection).where(Detection.image_id == image.id)
        detections_result = await db.execute(detections_query)
        detections = detections_result.scalars().all()

        for detection in detections:
            await db.execute(
                sql_delete(Classification).where(Classification.detection_id == detection.id)
            )

        await db.execute(
            sql_delete(Detection).where(Detection.image_id == image.id)
        )

    await db.execute(sql_delete(Image).where(Image.camera_id == camera.id))

    # Delete MinIO files
    try:
        storage = StorageClient()
        for bucket in [BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS]:
            for obj_name in storage.list_objects(bucket, prefix=f"{camera_device_id}/"):
                storage.delete_object(bucket, obj_name)
    except Exception as e:
        logger.error(
            "Failed to delete some MinIO files",
            camera_id=camera.id,
            device_id=camera_device_id,
            error=str(e),
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
    Required: CameraID. Optional: Name, Notes. All other columns are stored as custom fields.

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

    required_headers = {'CameraID'}
    missing_headers = required_headers - actual_headers
    if missing_headers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required CSV headers: {', '.join(sorted(missing_headers))}",
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

    # Columns that are not stored in custom_fields
    reserved_columns = {'CameraID', 'Name', 'FriendlyName', 'Notes'}

    # Process rows
    results: List[CameraImportRow] = []
    success_count = 0
    failed_count = 0

    for idx, row in enumerate(rows, start=2):  # Start at 2 (1 for header + 1-indexed)
        device_id = (row.get('CameraID') or '').strip()

        # Validate camera ID is present
        if not device_id:
            results.append(CameraImportRow(
                row_number=idx,
                device_id='',
                success=False,
                error="CameraID is required"
            ))
            failed_count += 1
            continue

        # Check if device ID already exists
        result = await db.execute(
            select(Camera).where(Camera.device_id == device_id)
        )
        existing_camera = result.scalar_one_or_none()

        if existing_camera:
            results.append(CameraImportRow(
                row_number=idx,
                device_id=device_id,
                success=False,
                error=f"Camera with ID {device_id} already exists"
            ))
            failed_count += 1
            continue

        friendly_name = (row.get('Name') or row.get('FriendlyName') or '').strip() or None
        notes = (row.get('Notes') or '').strip()

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
                device_id=device_id,
                name=friendly_name if friendly_name else device_id,
                notes=notes,
                custom_fields=custom_fields if custom_fields else {},
                project_id=project_id,
                status='inventory',
                config={}
            )

            db.add(camera)
            await db.flush()  # Flush to get the ID

            results.append(CameraImportRow(
                row_number=idx,
                device_id=device_id,
                success=True,
                camera_id=camera.id
            ))
            success_count += 1

        except Exception as e:
            results.append(CameraImportRow(
                row_number=idx,
                device_id=device_id,
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
