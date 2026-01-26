"""
Database operations for ingestion service
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy import and_
from sqlalchemy.orm.attributes import flag_modified
from shared.database import get_db_session
from shared.models import Camera, Image, Project
from shared.logger import get_logger
from camera_profiles import CameraProfile

logger = get_logger("ingestion")


def get_camera_by_imei(imei: str) -> Optional[int]:
    """
    Get camera by IMEI.

    Args:
        imei: Camera IMEI (from EXIF SerialNumber or daily report IMEI field)

    Returns:
        Database ID of camera (integer) if found, None otherwise
    """
    with get_db_session() as session:
        # Look up camera by IMEI
        camera = session.query(Camera).filter_by(imei=imei).first()

        if camera:
            db_id = camera.id  # Access ID before session closes
            logger.debug(
                "Found existing camera",
                imei=imei,
                camera_name=camera.name,
                db_id=db_id
            )
            return db_id

        logger.debug(
            "Camera not found",
            imei=imei
        )
        return None


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

        return image_uuid


def update_camera_health(imei: str, health_data: dict) -> bool:
    """
    Update camera record with health data from daily report.

    Stores health data in camera.config JSON field.

    Args:
        imei: Camera IMEI
        health_data: Parsed daily report data

    Returns:
        True if camera found and updated, False if camera not found
    """
    with get_db_session() as session:
        # Look up camera by IMEI
        camera = session.query(Camera).filter_by(imei=imei).first()

        if not camera:
            logger.warning(
                "Daily report for unknown camera",
                imei=imei
            )
            return False

        # Update config JSON with health data
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

        # Update GPS location if present in daily report
        if health_data.get('gps_location'):
            lat, lon = health_data['gps_location']
            # Update camera location from daily report GPS
            # Note: This requires PostGIS Geography type
            # For now, store in config JSON as well
            camera.config['gps_from_report'] = {'lat': lat, 'lon': lon}

        # Mark config as modified so SQLAlchemy detects the change
        flag_modified(camera, 'config')

        session.flush()

        logger.info(
            "Updated camera health",
            imei=imei,
            camera_name=camera.name,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature'),
            signal_quality=health_data.get('signal_quality')
        )

        return True
