"""
Database operations for ingestion service
"""
import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.orm.attributes import flag_modified
from shared.database import get_db_session
from shared.deployment_rebuild import rebuild_camera
from shared.models import Camera, CameraHealthReport, DeploymentStatement, Image, Rejection, ServerSettings
from shared.logger import get_logger
from utils import is_valid_gps

logger = get_logger("ingestion")


def get_server_timezone() -> ZoneInfo:
    """
    Return the configured server timezone as a ZoneInfo object.

    The ingestion pipeline stores camera wall-clock times as naive datetimes,
    so this value is not needed for writes. It is used only for side
    validations (e.g. warning when an EXIF OffsetTimeOriginal tag disagrees
    with the declared server timezone). Falls back to UTC if unset.
    """
    with get_db_session() as session:
        result = session.execute(select(ServerSettings).limit(1))
        settings = result.scalar_one_or_none()
        name = settings.timezone if settings and settings.timezone else "UTC"
        return ZoneInfo(name)


def get_camera_by_device_id(device_id: str) -> Optional[int]:
    """
    Get camera by device ID.

    Args:
        device_id: Camera device ID (from EXIF SerialNumber or daily report IMEI field)

    Returns:
        Database ID of camera (integer) if found, None otherwise
    """
    with get_db_session() as session:
        # Retired cameras are skipped: a retired device that still
        # uploads is an unknown camera until someone registers it again.
        camera = session.query(Camera).filter_by(device_id=device_id, retired_at=None).first()

        if camera:
            db_id = camera.id  # Access ID before session closes
            logger.debug(
                "Found existing camera",
                device_id=device_id,
                camera_name=camera.device_id,
                db_id=db_id
            )
            return db_id

        logger.debug(
            "Camera not found",
            device_id=device_id
        )
        return None


def find_same_photo(camera_id: int, filename: str, captured_at: datetime) -> Optional[dict]:
    """
    The image this camera already stored for this photo, or None.

    Same photo means the same file name and the same camera clock second,
    the key bulk_dedup uses too. Used by the hold for cameras that send a
    broken photo again (resend_hold.py).

    Returns:
        dict with ingested_at, storage_path and privacy_removed_at
    """
    with get_db_session() as session:
        row = session.execute(
            select(Image.ingested_at, Image.storage_path, Image.privacy_removed_at)
            .where(
                Image.camera_id == camera_id,
                Image.filename == filename,
                Image.captured_at == captured_at,
            )
            .order_by(Image.id)
            .limit(1)
        ).first()
        if row is None:
            return None
        return {
            "ingested_at": row.ingested_at,
            "storage_path": row.storage_path,
            "privacy_removed_at": row.privacy_removed_at,
        }


def create_rejection_record(
    disk_path: str,
    filename: str,
    reason: str,
    details: Optional[str] = None,
    device_id: Optional[str] = None,
    captured_at: Optional[datetime] = None,
    exif_metadata: Optional[dict] = None,
    source_path: Optional[str] = None,
) -> None:
    """
    Record a rejected file. The row is the only record of the rejection.

    Resolves camera_id and project_id from device_id where possible. The camera
    lookup runs here (not at the call site) because most rejections happen before
    ingestion's own camera lookup. project_id stays None when device_id is missing
    or the camera is not registered, so the row never appears in a project feed.

    Args:
        disk_path: Absolute path of the moved file in the rejected/ tree
        source_path: Where the file sat under the upload root before the move,
            relative POSIX. Reprocess restores it there.
        filename: Original camera filename
        reason: Rejection reason (matches the rejected/ subdirectory)
        details: Human-readable rejection detail
        device_id: Camera device id if it was extracted before the reject
        captured_at: Camera wall-clock at capture (naive) if known
        exif_metadata: EXIF metadata captured at reject time, if any
    """
    try:
        file_size_bytes = os.path.getsize(disk_path)
    except OSError:
        file_size_bytes = None

    with get_db_session() as session:
        camera_id = None
        project_id = None
        if device_id:
            camera = session.query(Camera).filter_by(device_id=device_id, retired_at=None).first()
            if camera:
                camera_id = camera.id
                project_id = camera.project_id

        rejection = Rejection(
            filename=filename,
            disk_path=disk_path,
            source_path=source_path,
            reason=reason,
            details=details,
            device_id=device_id,
            camera_id=camera_id,
            project_id=project_id,
            captured_at=captured_at,
            exif_metadata=exif_metadata,
            file_size_bytes=file_size_bytes,
        )
        session.add(rejection)
        session.flush()
        logger.info(
            "Recorded rejection",
            reason=reason,
            device_id=device_id,
            project_id=project_id,
            disk_path=disk_path,
        )


def delete_old_rejections(retention_days: int = 30) -> int:
    """
    Delete Rejection rows older than the retention window.

    Called from cleanup_old_rejected_files so the table ages out in lockstep
    with the rejected/ files on disk. Returns the number of rows deleted.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    with get_db_session() as session:
        deleted = (
            session.query(Rejection)
            .filter(Rejection.rejected_at < cutoff)
            .delete(synchronize_session=False)
        )
    return deleted


def rebuild_deployments(camera_id: int) -> None:
    """Rebuild one camera's deployments in a transaction of its own. For the
    callers that add many photos first: a bulk job rebuilds once at its end."""
    with get_db_session() as session:
        rebuild_camera(session, camera_id)


def state_upload_to_site(
    camera_id: int,
    site_id: int,
    bulk_upload_job_id: int,
    start_date: Optional[date],
    end_date: Optional[date],
) -> None:
    """
    Record that an upload placed this camera at a chosen site: one statement
    for the days the photos span. It is exactly that period, so importing an
    old SD card never changes where the camera stands now.

    The dates come from the upload. When it sent none, they are the first and
    the last day of the photos the job stored. No dates and no photos means
    there is nothing to state.

    Raises:
        ValueError: the site does not exist.
    """
    with get_db_session() as session:
        if session.execute(text("SELECT 1 FROM sites WHERE id = :id"), {"id": site_id}).first() is None:
            raise ValueError(f"Site {site_id} not found")
        if start_date is None or end_date is None:
            span = session.execute(
                text("""
                    SELECT min(captured_at)::date AS first, max(captured_at)::date AS last
                    FROM images WHERE bulk_upload_job_id = :job_id
                """),
                {"job_id": bulk_upload_job_id},
            ).first()
            start_date = start_date or span.first
            end_date = end_date or span.last
        if start_date is None or end_date is None:
            return
        session.add(DeploymentStatement(
            camera_id=camera_id,
            site_id=site_id,
            from_at=datetime.combine(start_date, datetime.min.time()),
            until_at=datetime.combine(end_date + timedelta(days=1), datetime.min.time()),
            source="upload",
        ))


def create_image_record(
    image_uuid: str,
    camera_id: int,
    filename: str,
    storage_path: str,
    thumbnail_path: str,
    captured_at: datetime,
    gps_reading: Optional[Tuple[float, float]],
    exif_metadata: dict,
    origin: str = "live",
    content_hash: Optional[str] = None,
    bulk_upload_job_id: Optional[int] = None,
    rebuild: bool = True,
) -> str:
    """
    Create image record in database.

    Args:
        image_uuid: UUID for the image
        camera_id: Database ID of camera
        filename: Image filename
        storage_path: Path in MinIO (e.g., "WUH09/2025/12/abc-123_image.jpg")
        thumbnail_path: Path to thumbnail in MinIO (e.g., "WUH09/2025/12/abc-123_image.jpg")
        captured_at: Camera wall-clock capture datetime (naive, interpreted under ServerSettings.timezone)
        gps_reading: the photo's own GPS, stored as-is in gps_lat and
            gps_lon, or None. An invalid reading is stored as empty.
        exif_metadata: Full EXIF data dictionary
        origin: 'live' for FTPS-ingested, 'bulk' for SD-card upload. Drives
            notification suppression downstream (bulk skips species_detection).
        content_hash: Optional SHA-256 hex of raw bytes. Used by bulk upload
            to deduplicate re-imports of the same SD card.

    Returns:
        Image UUID (string)
    """
    gps_lat, gps_lon = gps_reading if is_valid_gps(gps_reading) else (None, None)

    with get_db_session() as session:
        image = Image(
            uuid=image_uuid,
            filename=filename,
            camera_id=camera_id,
            captured_at=captured_at,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            status="pending",  # Will be updated by detection worker
            image_metadata=exif_metadata,  # Store full EXIF as JSON
            gps_lat=gps_lat,
            gps_lon=gps_lon,
            origin=origin,
            content_hash=content_hash,
            bulk_upload_job_id=bulk_upload_job_id,
        )

        session.add(image)
        session.flush()  # Get image.id

        # The photo and the deployment it lands on are saved together. A bulk
        # job passes rebuild=False and rebuilds once at its end.
        if rebuild:
            rebuild_camera(session, camera_id)

        db_id = image.id  # Access before session closes

        logger.info(
            "Created image record",
            image_id=db_id,
            image_uuid=image_uuid,
            camera_id=camera_id,
            file_name=filename,
            has_gps=gps_lat is not None,
            has_thumbnail=bool(thumbnail_path)
        )

    return image_uuid


def update_camera_health(device_id: str, health_data: dict) -> bool:
    """
    Update camera record with health data from daily report.

    Stores health data in:
    1. camera.config JSON field (for current status display)
    2. camera_health_reports table (for historical tracking)

    Args:
        device_id: Camera device ID
        health_data: Parsed daily report data

    Returns:
        True if camera found and updated, False if camera not found
    """
    with get_db_session() as session:
        camera = session.query(Camera).filter_by(device_id=device_id, retired_at=None).first()

        if not camera:
            logger.warning(
                "Daily report for unknown camera",
                device_id=device_id
            )
            return False

        # Store camera_id before session closes
        camera_id = camera.id

        # Camera wall-clock time from the parsed report. Fall back to the
        # server's current naive UTC clock if the report had no timestamp,
        # so malformed reports still land in the health table.
        report_datetime = health_data.get('report_datetime') or datetime.utcnow()

        # Update config JSON with health data (for current status)
        camera.config = camera.config or {}
        camera.config['last_health_report'] = {
            'signal_quality': health_data.get('signal_quality'),
            'temperature': health_data.get('temperature'),
            'battery_percentage': health_data.get('battery_percentage'),
            'sd_utilization_percentage': health_data.get('sd_utilization_percentage'),
            'total_images': health_data.get('total_images'),
            'sent_images': health_data.get('sent_images'),
        }

        # Update GPS location if the daily report has a valid GPS reading.
        # Bad readings like (0, 0) or out-of-range values are ignored so they
        # do not poison camera.config['gps_from_report'] (which other services
        # like excessive_images.py read for the email Location field).
        report_gps = health_data.get('gps_location')
        report_lat, report_lon = report_gps if is_valid_gps(report_gps) else (None, None)
        if report_lat is not None:
            camera.config['gps_from_report'] = {'lat': report_lat, 'lon': report_lon}
        elif report_gps is not None:
            logger.warning(
                "Daily report has invalid GPS, skipping camera location update",
                device_id=device_id,
                gps=report_gps,
            )

        # Mark config as modified so SQLAlchemy detects the change
        flag_modified(camera, 'config')

        # Insert or update historical health report (UPSERT on one-per-day).
        # The DB has a functional unique index on (camera_id, reported_at::date)
        # so we match on the same expression to hit it.
        report_day = report_datetime.date()
        existing_report = session.query(CameraHealthReport).filter(
            CameraHealthReport.camera_id == camera_id,
            func.date(CameraHealthReport.reported_at) == report_day
        ).first()

        if existing_report:
            existing_report.reported_at = report_datetime
            existing_report.battery_percent = health_data.get('battery_percentage')
            existing_report.signal_quality = health_data.get('signal_quality')
            existing_report.temperature_c = health_data.get('temperature')
            existing_report.sd_utilization_percent = health_data.get('sd_utilization_percentage')
            existing_report.total_images = health_data.get('total_images')
            existing_report.sent_images = health_data.get('sent_images')
            existing_report.gps_lat = report_lat
            existing_report.gps_lon = report_lon
            logger.debug("Updated existing health report", camera_id=camera_id, day=report_day)
        else:
            health_report = CameraHealthReport(
                camera_id=camera_id,
                reported_at=report_datetime,
                battery_percent=health_data.get('battery_percentage'),
                signal_quality=health_data.get('signal_quality'),
                temperature_c=health_data.get('temperature'),
                sd_utilization_percent=health_data.get('sd_utilization_percentage'),
                total_images=health_data.get('total_images'),
                sent_images=health_data.get('sent_images'),
                gps_lat=report_lat,
                gps_lon=report_lon,
            )
            session.add(health_report)
            logger.debug("Created new health report", camera_id=camera_id, day=report_day)

        session.flush()

        logger.info(
            "Updated camera health",
            device_id=device_id,
            camera_name=camera.device_id,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature'),
            signal_quality=health_data.get('signal_quality')
        )

    return True
