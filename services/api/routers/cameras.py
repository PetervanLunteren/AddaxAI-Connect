"""
Camera endpoints for viewing camera trap devices and their health status.
"""
from typing import List, Optional
from datetime import datetime, timedelta, date
import csv
import io
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from shared.models import User, Camera, Project
from shared.database import get_async_session
from auth.users import current_active_user
from auth.permissions import can_admin_project
from auth.project_access import get_accessible_project_ids


router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraResponse(BaseModel):
    """Camera response with health status"""
    id: int
    name: str
    imei: Optional[str] = None
    serial_number: Optional[str] = None
    box: Optional[str] = None
    order: Optional[str] = None
    scanned_date: Optional[date] = None
    firmware: Optional[str] = None
    remark: Optional[str] = None
    has_sim: Optional[bool] = None
    imsi: Optional[str] = None
    iccid: Optional[str] = None
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
    friendly_name: Optional[str] = None  # Display name (optional, defaults to IMEI)
    serial_number: Optional[str] = None
    box: Optional[str] = None
    order: Optional[str] = None
    scanned_date: Optional[date] = None
    firmware: Optional[str] = None
    remark: Optional[str] = None
    has_sim: Optional[bool] = None
    imsi: Optional[str] = None
    iccid: Optional[str] = None
    project_id: int


class UpdateCameraRequest(BaseModel):
    """Request model for updating camera"""
    friendly_name: Optional[str] = None
    serial_number: Optional[str] = None
    box: Optional[str] = None
    order: Optional[str] = None
    scanned_date: Optional[date] = None
    firmware: Optional[str] = None
    remark: Optional[str] = None
    has_sim: Optional[bool] = None
    imsi: Optional[str] = None
    iccid: Optional[str] = None
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
        imei=camera.imei,
        serial_number=camera.serial_number,
        box=camera.box,
        order=camera.order,
        scanned_date=camera.scanned_date,
        firmware=camera.firmware,
        remark=camera.remark,
        has_sim=camera.has_sim,
        imsi=camera.imsi,
        iccid=camera.iccid,
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
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    List all cameras with health status

    Returns cameras filtered by user's accessible projects:
    - Server admins: all cameras
    - Regular users: only cameras from their assigned projects

    Args:
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        List of cameras with health data
    """
    # Filter cameras by accessible projects
    query = select(Camera).where(Camera.project_id.in_(accessible_project_ids))
    result = await db.execute(query)
    cameras = result.scalars().all()

    return [camera_to_response(camera) for camera in cameras]


@router.get(
    "/{camera_id}",
    response_model=CameraResponse,
)
async def get_camera(
    camera_id: int,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
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

    return camera_to_response(camera)


@router.post(
    "",
    response_model=CameraResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_camera(
    request: CreateCameraRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
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
        serial_number=request.serial_number,
        box=request.box,
        order=request.order,
        scanned_date=request.scanned_date,
        firmware=request.firmware,
        remark=request.remark,
        has_sim=request.has_sim,
        imsi=request.imsi,
        iccid=request.iccid,
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
    current_user: User = Depends(current_active_user),
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
    if request.serial_number is not None:
        camera.serial_number = request.serial_number
    if request.box is not None:
        camera.box = request.box
    if request.order is not None:
        camera.order = request.order
    if request.scanned_date is not None:
        camera.scanned_date = request.scanned_date
    if request.firmware is not None:
        camera.firmware = request.firmware
    if request.remark is not None:
        camera.remark = request.remark
    if request.has_sim is not None:
        camera.has_sim = request.has_sim
    if request.imsi is not None:
        camera.imsi = request.imsi
    if request.iccid is not None:
        camera.iccid = request.iccid
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
    current_user: User = Depends(current_active_user),
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
    project_id: int = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Bulk import cameras from CSV file (project admin or server admin)

    Expected CSV format with headers (delimiter auto-detected: comma or semicolon):
    IMEI,Serial,Order,Scanned,Firmware,Remark,SIM,IMSI,ICCID
    OR
    IMEI,FriendlyName,SerialNumber,Box,Order,ScannedDate (backward compatible)

    Only IMEI is required. All other fields are optional.
    Date format: DD-MM-YYYY or YYYY-MM-DD
    SIM field: TRUE/FALSE (case-insensitive)

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
    # Project ID is required
    if project_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id is required for bulk import",
        )

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
        csv_text = content.decode('utf-8')
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
    required_headers = {'IMEI'}
    optional_headers = {'FriendlyName', 'Serial', 'SerialNumber', 'Box', 'Order', 'Scanned', 'ScannedDate',
                       'Firmware', 'Remark', 'SIM', 'IMSI', 'ICCID'}
    all_headers = required_headers | optional_headers

    actual_headers = set(rows[0].keys())

    if not required_headers.issubset(actual_headers):
        missing = required_headers - actual_headers
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Missing required CSV headers: {', '.join(missing)}",
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

        # Parse optional fields (handle None values from CSV)
        # Support both old and new field names
        friendly_name = (row.get('FriendlyName') or '').strip() or None
        serial_number = (row.get('Serial') or row.get('SerialNumber') or '').strip() or None
        box = (row.get('Box') or '').strip() or None
        order = (row.get('Order') or '').strip() or None
        firmware = (row.get('Firmware') or '').strip() or None
        remark = (row.get('Remark') or '').strip() or None
        imsi = (row.get('IMSI') or '').strip() or None
        iccid = (row.get('ICCID') or '').strip() or None

        # Parse has_sim (boolean from TRUE/FALSE string)
        has_sim = None
        sim_str = (row.get('SIM') or '').strip().upper()
        if sim_str == 'TRUE':
            has_sim = True
        elif sim_str == 'FALSE':
            has_sim = False

        # Parse scanned_date if present (try multiple formats)
        scanned_date = None
        scanned_date_str = (row.get('Scanned') or row.get('ScannedDate') or '').strip()
        if scanned_date_str:
            # Try DD-MM-YYYY format first (new format)
            try:
                scanned_date = datetime.strptime(scanned_date_str, '%d-%m-%Y').date()
            except ValueError:
                # Fall back to YYYY-MM-DD format (old format)
                try:
                    scanned_date = datetime.strptime(scanned_date_str, '%Y-%m-%d').date()
                except ValueError:
                    results.append(CameraImportRow(
                        row_number=idx,
                        imei=imei,
                        success=False,
                        error=f"Invalid date format '{scanned_date_str}'. Use DD-MM-YYYY or YYYY-MM-DD"
                    ))
                    failed_count += 1
                    continue

        # Create camera
        try:
            camera = Camera(
                imei=imei,
                name=friendly_name if friendly_name else imei,  # Default to IMEI if no friendly name
                serial_number=serial_number,
                box=box,
                order=order,
                scanned_date=scanned_date,
                firmware=firmware,
                remark=remark,
                has_sim=has_sim,
                imsi=imsi,
                iccid=iccid,
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
