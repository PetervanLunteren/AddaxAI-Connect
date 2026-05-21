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
from sqlalchemy import select, func, and_, text, delete as sql_delete
from pydantic import BaseModel

from shared.models import User, Camera, Project, Image, CameraHealthReport, Detection, Classification
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from auth.project_access import get_accessible_project_ids, narrow_to_project
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger
from utils.camera_status import camera_status as _camera_status

logger = get_logger(__name__)

router = APIRouter(prefix="/api/cameras", tags=["cameras"])


class CameraResponse(BaseModel):
    """Camera response with health status"""
    id: int
    name: str  # display label: device_id, else "Camera <id>". Cameras have no friendly name.
    device_id: Optional[str] = None
    custom_fields: Optional[dict] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    location: Optional[dict] = None  # {lat, lon} from the latest daily report (GPS health signal)
    current_site: Optional[dict] = None  # {id, name, label} of the camera's current deployment site
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
    sim_expiry_date: Optional[str] = None  # YYYY-MM-DD or null

    class Config:
        from_attributes = True


class CreateCameraRequest(BaseModel):
    """Request model for creating a new camera"""
    device_id: str
    notes: Optional[str] = None
    custom_fields: Optional[dict] = None
    tags: Optional[List[str]] = None
    project_id: int
    sim_expiry_date: Optional[date] = None


class UpdateCameraRequest(BaseModel):
    """Request model for updating camera"""
    custom_fields: Optional[dict] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    sim_expiry_date: Optional[date] = None


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
    current_site: Optional[dict] = None,
) -> CameraResponse:
    """Convert a Camera model to the API response shape."""
    health_data = camera.config.get('last_health_report', {}) if camera.config else {}
    gps_data = camera.config.get('gps_from_report') if camera.config else None

    # Cameras have no friendly name; the label is the device id (or a fallback).
    display_name = camera.device_id or f"Camera {camera.id}"

    return CameraResponse(
        current_site=current_site,
        id=camera.id,
        name=display_name,
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
        sim_expiry_date=camera.sim_expiry_date.isoformat() if camera.sim_expiry_date else None,
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

    # Each camera's current site = the site of its most recent deployment.
    current_site_map: dict[int, dict] = {}
    if camera_ids:
        site_rows = await db.execute(
            text("""
                SELECT DISTINCT ON (d.camera_id) d.camera_id, d.name AS label,
                       s.id AS site_id, s.name AS site_name
                FROM deployments d
                LEFT JOIN sites s ON s.id = d.site_id
                WHERE d.camera_id = ANY(:cam_ids)
                ORDER BY d.camera_id, d.deployment_number DESC
            """),
            {"cam_ids": camera_ids},
        )
        for r in site_rows.mappings().all():
            if r["site_id"] is not None:
                current_site_map[r["camera_id"]] = {
                    "id": r["site_id"], "name": r["site_name"], "label": r["label"],
                }

    from routers.admin import get_server_timezone
    tz = ZoneInfo(await get_server_timezone(db))

    return [
        camera_to_response(
            camera,
            tz=tz,
            last_captured_at=last_captured_map.get(camera.id),
            last_reported_at=last_reported_map.get(camera.id),
            current_site=current_site_map.get(camera.id),
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


# Bulk-edit endpoints. Declared before /{camera_id} so FastAPI matches the
# literal segment first (otherwise "bulk-add-tags" gets coerced to camera_id:
# int and 422s, same gotcha that bit /export-csv).

class BulkCameraIdsRequest(BaseModel):
    """Common payload prefix: every bulk action operates on a list of cameras."""
    camera_ids: List[int]


class BulkAddTagsRequest(BulkCameraIdsRequest):
    tags: List[str]


class BulkRemoveTagsRequest(BulkCameraIdsRequest):
    tags: List[str]


class BulkSetSimExpiryRequest(BulkCameraIdsRequest):
    # Explicit null clears the column on every selected camera. Omitted in the
    # body would parse as null too, so the frontend always sends the field.
    sim_expiry_date: Optional[date] = None


class BulkSetNotesRequest(BulkCameraIdsRequest):
    # Empty string is a valid clear; the frontend confirms the destructive
    # nature in the dialog before firing.
    notes: str


class BulkUpdateResponse(BaseModel):
    updated_count: int


async def _load_bulk_cameras(
    db: AsyncSession, camera_ids: List[int],
) -> List[Camera]:
    """
    Fetch the cameras for a bulk request and reject empty lists or stale IDs.

    Caller must still verify project-admin access on every distinct project
    referenced by the loaded cameras.
    """
    if not camera_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="camera_ids must not be empty",
        )

    requested = set(camera_ids)
    result = await db.execute(
        select(Camera).where(Camera.id.in_(requested))
    )
    cameras = list(result.scalars().all())

    found = {c.id for c in cameras}
    missing = sorted(requested - found)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown camera IDs: {missing}",
        )

    return cameras


async def _verify_admin_on_all_projects(
    user: User, cameras: List[Camera], db: AsyncSession,
) -> None:
    """Reject the request if the user is not a project admin (or server
    admin) on every distinct project the bulk selection touches."""
    project_ids = {c.project_id for c in cameras if c.project_id is not None}
    for project_id in project_ids:
        if not await can_admin_project(user, project_id, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Project admin access required for project {project_id}",
            )


@router.post("/bulk-add-tags", response_model=BulkUpdateResponse)
async def bulk_add_tags(
    request: BulkAddTagsRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Append the given tags to every selected camera. Existing tags are kept,
    duplicates collapse via normalize_tags."""
    if not request.tags:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tags must not be empty",
        )

    cameras = await _load_bulk_cameras(db, request.camera_ids)
    await _verify_admin_on_all_projects(current_user, cameras, db)

    incoming = normalize_tags(request.tags)
    for camera in cameras:
        merged = list(camera.tags or []) + incoming
        camera.tags = normalize_tags(merged)

    await db.commit()
    return BulkUpdateResponse(updated_count=len(cameras))


@router.post("/bulk-remove-tags", response_model=BulkUpdateResponse)
async def bulk_remove_tags(
    request: BulkRemoveTagsRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Remove the given tags from every selected camera. Tags not present are
    a no-op for that row; the request never errors on a missing tag."""
    if not request.tags:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tags must not be empty",
        )

    cameras = await _load_bulk_cameras(db, request.camera_ids)
    await _verify_admin_on_all_projects(current_user, cameras, db)

    to_remove = set(normalize_tags(request.tags))
    for camera in cameras:
        camera.tags = [t for t in (camera.tags or []) if t not in to_remove]

    await db.commit()
    return BulkUpdateResponse(updated_count=len(cameras))


@router.post("/bulk-set-sim-expiry", response_model=BulkUpdateResponse)
async def bulk_set_sim_expiry(
    request: BulkSetSimExpiryRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Set sim_expiry_date on every selected camera. null clears the column."""
    cameras = await _load_bulk_cameras(db, request.camera_ids)
    await _verify_admin_on_all_projects(current_user, cameras, db)

    for camera in cameras:
        camera.sim_expiry_date = request.sim_expiry_date

    await db.commit()
    return BulkUpdateResponse(updated_count=len(cameras))


@router.post("/bulk-set-notes", response_model=BulkUpdateResponse)
async def bulk_set_notes(
    request: BulkSetNotesRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Replace notes on every selected camera with the given string. Empty
    string clears the field."""
    cameras = await _load_bulk_cameras(db, request.camera_ids)
    await _verify_admin_on_all_projects(current_user, cameras, db)

    for camera in cameras:
        camera.notes = request.notes

    await db.commit()
    return BulkUpdateResponse(updated_count=len(cameras))


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

    site_row = (await db.execute(
        text("""
            SELECT d.name AS label, s.id AS site_id, s.name AS site_name
            FROM deployments d
            LEFT JOIN sites s ON s.id = d.site_id
            WHERE d.camera_id = :cam
            ORDER BY d.deployment_number DESC
            LIMIT 1
        """),
        {"cam": camera_id},
    )).mappings().first()
    current_site = None
    if site_row and site_row["site_id"] is not None:
        current_site = {
            "id": site_row["site_id"], "name": site_row["site_name"], "label": site_row["label"],
        }

    return camera_to_response(
        camera,
        tz=tz,
        last_captured_at=last_captured_at,
        last_reported_at=last_reported_at,
        current_site=current_site,
    )


class CameraDeploymentResponse(BaseModel):
    """One deployment in a camera's history: where it was and for how long."""
    id: int
    deployment_number: int
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    label: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    image_count: int


@router.get(
    "/{camera_id}/deployments",
    response_model=List[CameraDeploymentResponse],
)
async def get_camera_deployments(
    camera_id: int,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Deployment history for one camera, oldest first. Each row is a period the
    camera spent at one site, with that site's name and the image count.
    """
    camera = (
        await db.execute(select(Camera).where(Camera.id == camera_id))
    ).scalar_one_or_none()
    if not camera:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Camera not found")
    if camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this camera",
        )

    rows = (
        await db.execute(
            text("""
                SELECT d.id, d.deployment_number, d.site_id, s.name AS site_name,
                       d.name AS label,
                       ST_Y(d.location::geometry) AS lat,
                       ST_X(d.location::geometry) AS lon,
                       d.start_date, d.end_date,
                       count(i.id) AS image_count
                FROM deployments d
                LEFT JOIN sites s ON s.id = d.site_id
                LEFT JOIN images i ON i.deployment_id = d.id
                WHERE d.camera_id = :camera_id
                GROUP BY d.id, s.name
                ORDER BY d.deployment_number
            """),
            {"camera_id": camera_id},
        )
    ).mappings().all()

    return [
        CameraDeploymentResponse(
            id=r["id"],
            deployment_number=r["deployment_number"],
            site_id=r["site_id"],
            site_name=r["site_name"],
            label=r["label"],
            latitude=float(r["lat"]) if r["lat"] is not None else None,
            longitude=float(r["lon"]) if r["lon"] is not None else None,
            start_date=r["start_date"].isoformat() if r["start_date"] else None,
            end_date=r["end_date"].isoformat() if r["end_date"] else None,
            image_count=r["image_count"],
        )
        for r in rows
    ]


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
        camera_name=camera.device_id or f"Camera {camera.id}",
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
        notes=request.notes or '',
        custom_fields=request.custom_fields or {},
        tags=normalize_tags(request.tags) if request.tags else [],
        project_id=request.project_id,
        status='inventory',
        config={},
        sim_expiry_date=request.sim_expiry_date,
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
    if request.custom_fields is not None:
        camera.custom_fields = request.custom_fields
    if request.notes is not None:
        camera.notes = request.notes
    if request.tags is not None:
        camera.tags = normalize_tags(request.tags)
    # Clearing must be possible (typo recovery, retired camera), so check
    # whether the field was sent explicitly rather than only checking for
    # not-None. An omitted field leaves the existing value alone; a null
    # value clears the column.
    if 'sim_expiry_date' in request.model_fields_set:
        camera.sim_expiry_date = request.sim_expiry_date

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
    reserved_columns = {'CameraID', 'Name', 'FriendlyName', 'Notes', 'SimExpiryDate'}

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

        # Optional SIM expiry. Strict YYYY-MM-DD; bad value rejects the row
        # so the operator notices and corrects rather than silently dropping
        # the column into custom_fields.
        sim_expiry_raw = (row.get('SimExpiryDate') or '').strip()
        sim_expiry_date = None
        if sim_expiry_raw:
            try:
                sim_expiry_date = datetime.strptime(sim_expiry_raw, '%Y-%m-%d').date()
            except ValueError:
                results.append(CameraImportRow(
                    row_number=idx,
                    device_id=device_id,
                    success=False,
                    error=f"Invalid SimExpiryDate '{sim_expiry_raw}', expected YYYY-MM-DD",
                ))
                failed_count += 1
                continue

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
                notes=notes,
                custom_fields=custom_fields if custom_fields else {},
                project_id=project_id,
                status='inventory',
                config={},
                sim_expiry_date=sim_expiry_date,
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
