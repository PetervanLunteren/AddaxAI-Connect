"""
Database operations for ingestion service
"""
import math
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import and_, func, select, text
from sqlalchemy.orm.attributes import flag_modified
from shared.database import get_db_session
from shared.models import Camera, CameraDeploymentPeriod, CameraHealthReport, Image, Project, ServerSettings
from shared.logger import get_logger
from camera_profiles import CameraProfile
from utils import is_valid_gps

logger = get_logger("ingestion")

# Constants
RELOCATION_THRESHOLD_METERS = 100.0  # GPS change >100m = new deployment


def get_server_timezone() -> ZoneInfo:
    """
    Return the configured server timezone as a ZoneInfo object.

    Falls back to UTC if no ServerSettings row exists or its ``timezone``
    column is null. Used by path-based camera profiles (e.g. INSTAR) whose
    cameras write local wall-clock times into the upload path: that
    wall-clock time has to be anchored to the server's timezone before
    PostgreSQL converts it to UTC for storage.
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
        camera = session.query(Camera).filter_by(device_id=device_id).first()

        if camera:
            db_id = camera.id  # Access ID before session closes
            logger.debug(
                "Found existing camera",
                device_id=device_id,
                camera_name=camera.name,
                db_id=db_id
            )
            return db_id

        logger.debug(
            "Camera not found",
            device_id=device_id
        )
        return None


def calculate_gps_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate distance between two GPS points using Haversine formula.

    Args:
        lat1: Latitude of point 1 (degrees)
        lon1: Longitude of point 1 (degrees)
        lat2: Latitude of point 2 (degrees)
        lon2: Longitude of point 2 (degrees)

    Returns:
        Distance in meters

    Raises:
        ValueError: If coordinates are out of valid range
    """
    # Validate coordinates
    if not (-90 <= lat1 <= 90) or not (-90 <= lat2 <= 90):
        raise ValueError(f"Latitude must be in [-90, 90]: {lat1}, {lat2}")
    if not (-180 <= lon1 <= 180) or not (-180 <= lon2 <= 180):
        raise ValueError(f"Longitude must be in [-180, 180]: {lon1}, {lon2}")

    # Haversine formula
    R = 6371000  # Earth radius in meters

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = math.sin(delta_lat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


def update_or_create_deployment(
    camera_id: int,
    new_gps: Tuple[float, float],
    event_date: date
) -> None:
    """
    Update or create camera deployment period based on GPS location.

    Creates new deployment when:
    - No active deployment exists (first image/report)
    - GPS moved >100m from current deployment location

    Args:
        camera_id: Database ID of camera
        new_gps: (latitude, longitude) from image or daily report
        event_date: Date of image or daily report

    Raises:
        ValueError: If GPS coordinates are invalid (None, (0, 0), or out of range).
    """
    # Defensive guard: callers should pre-validate, but raise loudly here
    # so any future caller cannot silently insert a (0, 0) zombie.
    if not is_valid_gps(new_gps):
        raise ValueError(f"Invalid GPS for camera {camera_id}: {new_gps}")

    with get_db_session() as session:
        new_lat, new_lon = new_gps

        # Get current active deployment (end_date IS NULL)
        current_deployment = session.query(CameraDeploymentPeriod).filter(
            and_(
                CameraDeploymentPeriod.camera_id == camera_id,
                CameraDeploymentPeriod.end_date.is_(None)
            )
        ).first()

        if current_deployment:
            # Extract current deployment location
            # PostGIS returns location as WKB - use ST_AsText to get "POINT(lon lat)"
            location_query = text("""
                SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon
                FROM camera_deployment_periods
                WHERE id = :deployment_id
            """)
            result = session.execute(
                location_query,
                {'deployment_id': current_deployment.id}
            ).fetchone()

            current_lat, current_lon = result.lat, result.lon

            # Calculate distance from current deployment
            distance = calculate_gps_distance(current_lat, current_lon, new_lat, new_lon)

            if distance > RELOCATION_THRESHOLD_METERS:
                # Camera relocated - close current deployment and start new one.
                # Clamp the closing date so it never falls before the deployment's
                # own start_date (otherwise a relocation on the same calendar day
                # the deployment was created leaves an inverted, impossible range
                # that no image can ever match).
                yesterday = event_date - timedelta(days=1)
                current_deployment.end_date = max(yesterday, current_deployment.start_date)

                # Get next deployment_id
                next_deployment_id = current_deployment.deployment_id + 1

                logger.info(
                    "Camera relocated - creating new deployment",
                    camera_id=camera_id,
                    old_deployment_id=current_deployment.deployment_id,
                    new_deployment_id=next_deployment_id,
                    distance_meters=round(distance, 1),
                    old_location=f"({current_lat:.6f}, {current_lon:.6f})",
                    new_location=f"({new_lat:.6f}, {new_lon:.6f})"
                )

                # Create new deployment
                location_wkt = f"POINT({new_lon} {new_lat})"
                insert_query = text("""
                    INSERT INTO camera_deployment_periods (
                        camera_id,
                        deployment_id,
                        start_date,
                        end_date,
                        location
                    ) VALUES (
                        :camera_id,
                        :deployment_id,
                        :start_date,
                        NULL,
                        ST_GeogFromText(:location_wkt)
                    )
                """)
                session.execute(
                    insert_query,
                    {
                        'camera_id': camera_id,
                        'deployment_id': next_deployment_id,
                        'start_date': event_date,
                        'location_wkt': location_wkt
                    }
                )

                session.flush()
            else:
                # Same deployment - backdate start_date if image arrived out of order
                if event_date < current_deployment.start_date:
                    logger.info(
                        "Backdating deployment start_date for out-of-order image",
                        camera_id=camera_id,
                        deployment_id=current_deployment.deployment_id,
                        old_start=str(current_deployment.start_date),
                        new_start=str(event_date),
                    )
                    current_deployment.start_date = event_date
                    session.flush()

                logger.debug(
                    "GPS within threshold - same deployment",
                    camera_id=camera_id,
                    deployment_id=current_deployment.deployment_id,
                    distance_meters=round(distance, 1)
                )
        else:
            # No active deployment - need to create one
            # Check if this camera had deployments before (they may be closed)
            max_deployment_id = session.query(
                func.max(CameraDeploymentPeriod.deployment_id)
            ).filter(
                CameraDeploymentPeriod.camera_id == camera_id
            ).scalar()

            if max_deployment_id is None:
                # Truly first deployment ever for this camera
                next_deployment_id = 1
                logger.info(
                    "Creating first deployment for camera",
                    camera_id=camera_id,
                    deployment_id=next_deployment_id,
                    location=f"({new_lat:.6f}, {new_lon:.6f})"
                )
            else:
                # Had deployments before - create new one with incremented ID
                next_deployment_id = max_deployment_id + 1
                logger.info(
                    "Resuming camera after closed deployment",
                    camera_id=camera_id,
                    previous_deployment_id=max_deployment_id,
                    new_deployment_id=next_deployment_id,
                    location=f"({new_lat:.6f}, {new_lon:.6f})"
                )

            location_wkt = f"POINT({new_lon} {new_lat})"
            insert_query = text("""
                INSERT INTO camera_deployment_periods (
                    camera_id,
                    deployment_id,
                    start_date,
                    end_date,
                    location
                ) VALUES (
                    :camera_id,
                    :deployment_id,
                    :start_date,
                    NULL,
                    ST_GeogFromText(:location_wkt)
                )
            """)
            session.execute(
                insert_query,
                {
                    'camera_id': camera_id,
                    'deployment_id': next_deployment_id,
                    'start_date': event_date,
                    'location_wkt': location_wkt
                }
            )

            session.flush()


def create_image_record(
    image_uuid: str,
    camera_id: int,
    filename: str,
    storage_path: str,
    thumbnail_path: str,
    datetime_original: datetime,
    gps_location: Optional[Tuple[float, float]],
    exif_metadata: dict
) -> str:
    """
    Create image record in database.

    Args:
        image_uuid: UUID for the image
        camera_id: Database ID of camera
        filename: Image filename
        storage_path: Path in MinIO (e.g., "WUH09/2025/12/abc-123_image.jpg")
        thumbnail_path: Path to thumbnail in MinIO (e.g., "WUH09/2025/12/abc-123_image.jpg")
        datetime_original: Image capture datetime
        gps_location: (latitude, longitude) or None
        exif_metadata: Full EXIF data dictionary

    Returns:
        Image UUID (string)
    """
    with get_db_session() as session:

        # Convert GPS to PostGIS format if present
        location_wkt = None
        if gps_location:
            lat, lon = gps_location
            location_wkt = f"POINT({lon} {lat})"  # PostGIS uses lon,lat order

        # Create image record
        image = Image(
            uuid=image_uuid,
            filename=filename,
            camera_id=camera_id,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            status="pending",  # Will be updated by detection worker
            image_metadata=exif_metadata  # Store full EXIF as JSON
        )

        # Manually set uploaded_at to datetime_original
        # (by default it uses server time via func.now())
        image.uploaded_at = datetime_original

        session.add(image)
        session.flush()  # Get image.id

        db_id = image.id  # Access before session closes

        logger.info(
            "Created image record",
            image_id=db_id,
            image_uuid=image_uuid,
            camera_id=camera_id,
            file_name=filename,
            has_gps=bool(gps_location),
            has_thumbnail=bool(thumbnail_path)
        )

    # Update deployment period if image has GPS
    # (done outside session context since update_or_create_deployment creates its own session)
    if gps_location:
        update_or_create_deployment(
            camera_id=camera_id,
            new_gps=gps_location,
            event_date=datetime_original.date()
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
        camera = session.query(Camera).filter_by(device_id=device_id).first()

        if not camera:
            logger.warning(
                "Daily report for unknown camera",
                device_id=device_id
            )
            return False

        # Store camera_id before session closes
        camera_id = camera.id

        # Use the date from the report itself, fall back to today if not available
        report_datetime = health_data.get('report_datetime')
        report_date = report_datetime.date() if report_datetime else datetime.now(timezone.utc).date()

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
        camera.config['last_report_timestamp'] = datetime.now(timezone.utc).isoformat()

        # Update GPS location if the daily report has a valid GPS reading.
        # Bad readings like (0, 0) or out-of-range values are ignored so they
        # do not poison camera.config['gps_from_report'] (which other services
        # like excessive_images.py read for the email Location field).
        report_gps = health_data.get('gps_location')
        if is_valid_gps(report_gps):
            lat, lon = report_gps
            # Note: This requires PostGIS Geography type
            # For now, store in config JSON as well
            camera.config['gps_from_report'] = {'lat': lat, 'lon': lon}
        elif report_gps is not None:
            logger.warning(
                "Daily report has invalid GPS, skipping camera location update",
                device_id=device_id,
                gps=report_gps,
            )

        # Mark config as modified so SQLAlchemy detects the change
        flag_modified(camera, 'config')

        # Insert or update historical health report (UPSERT pattern)
        existing_report = session.query(CameraHealthReport).filter(
            CameraHealthReport.camera_id == camera_id,
            CameraHealthReport.report_date == report_date
        ).first()

        if existing_report:
            # Update existing report for today
            existing_report.battery_percent = health_data.get('battery_percentage')
            existing_report.signal_quality = health_data.get('signal_quality')
            existing_report.temperature_c = health_data.get('temperature')
            existing_report.sd_utilization_percent = health_data.get('sd_utilization_percentage')
            existing_report.total_images = health_data.get('total_images')
            existing_report.sent_images = health_data.get('sent_images')
            logger.debug("Updated existing health report", camera_id=camera_id, date=report_date)
        else:
            # Create new health report for today
            health_report = CameraHealthReport(
                camera_id=camera_id,
                report_date=report_date,
                battery_percent=health_data.get('battery_percentage'),
                signal_quality=health_data.get('signal_quality'),
                temperature_c=health_data.get('temperature'),
                sd_utilization_percent=health_data.get('sd_utilization_percentage'),
                total_images=health_data.get('total_images'),
                sent_images=health_data.get('sent_images'),
            )
            session.add(health_report)
            logger.debug("Created new health report", camera_id=camera_id, date=report_date)

        session.flush()

        logger.info(
            "Updated camera health",
            device_id=device_id,
            camera_name=camera.name,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature'),
            signal_quality=health_data.get('signal_quality')
        )

    # Update deployment period if daily report has valid GPS. Health data
    # (battery, temperature) is the file's main payload and is already saved
    # above, so an invalid GPS is logged and skipped, not file-rejected.
    # (done outside session context since update_or_create_deployment creates its own session)
    report_gps = health_data.get('gps_location')
    if is_valid_gps(report_gps):
        update_or_create_deployment(
            camera_id=camera_id,
            new_gps=report_gps,
            event_date=datetime.now(timezone.utc).date()
        )
    elif report_gps is not None:
        logger.warning(
            "Daily report has invalid GPS, skipping deployment update",
            device_id=device_id,
            gps=report_gps,
        )

    return True
