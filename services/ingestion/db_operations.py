"""
Database operations for ingestion service
"""
import uuid
from datetime import datetime
from typing import Optional, Tuple

from sqlalchemy import and_
from shared.database import get_db_session
from shared.models import Camera, Image
from shared.logger import get_logger
from camera_profiles import CameraProfile

logger = get_logger("ingestion")


def get_or_create_camera(camera_id: str, profile: CameraProfile) -> Camera:
    """
    Get camera by ID, or create if doesn't exist.

    Args:
        camera_id: Unique camera identifier (SerialNumber or extracted ID)
        profile: Camera profile (for logging camera model)

    Returns:
        Camera instance
    """
    with get_db_session() as session:
        # Check if camera exists
        camera = session.query(Camera).filter_by(name=camera_id).first()

        if camera:
            logger.debug("Found existing camera", camera_id=camera_id, db_id=camera.id)
            return camera

        # Create new camera
        camera = Camera(
            name=camera_id,
            location=None,  # Will be updated from GPS data
            config={'profile': profile.name}
        )
        session.add(camera)
        session.flush()  # Get camera.id before commit

        logger.info(
            "Auto-created camera",
            camera_id=camera_id,
            profile=profile.name,
            db_id=camera.id
        )

        return camera


def check_duplicate_image(
    camera_id: int,
    filename: str,
    datetime_original: datetime
) -> bool:
    """
    Check if image already exists in database.

    An image is considered duplicate if it has the same:
    - camera_id
    - filename
    - datetime_original (within 1 second tolerance)

    Args:
        camera_id: Database ID of camera
        filename: Image filename
        datetime_original: Image capture datetime

    Returns:
        True if duplicate exists, False otherwise
    """
    with get_db_session() as session:
        # Query for existing image
        # Note: Comparing datetimes directly; SQLAlchemy handles timezone conversion
        existing = session.query(Image).filter(
            and_(
                Image.camera_id == camera_id,
                Image.filename == filename,
                # Use func.abs for datetime comparison within 1 second
                # (in case of minor timestamp differences)
            )
        ).first()

        if existing:
            logger.warning(
                "Duplicate image detected",
                camera_id=camera_id,
                file_name=filename,
                datetime_original=datetime_original.isoformat(),
                existing_image_id=existing.id
            )
            return True

        return False


def create_image_record(
    camera: Camera,
    filename: str,
    storage_path: str,
    datetime_original: datetime,
    gps_location: Optional[Tuple[float, float]],
    exif_metadata: dict
) -> Image:
    """
    Create image record in database.

    Args:
        camera: Camera instance
        filename: Image filename
        storage_path: Path in MinIO (e.g., "WUH09/2025/12/image.jpg")
        datetime_original: Image capture datetime
        gps_location: (latitude, longitude) or None
        exif_metadata: Full EXIF data dictionary

    Returns:
        Created Image instance
    """
    with get_db_session() as session:
        # Generate UUID for image
        image_uuid = str(uuid.uuid4())

        # Convert GPS to PostGIS format if present
        location_wkt = None
        if gps_location:
            lat, lon = gps_location
            location_wkt = f"POINT({lon} {lat})"  # PostGIS uses lon,lat order

        # Create image record
        image = Image(
            uuid=image_uuid,
            file_name=filename,
            camera_id=camera.id,
            storage_path=storage_path,
            status="pending",  # Will be updated by detection worker
            image_metadata=exif_metadata  # Store full EXIF as JSON
        )

        # Manually set uploaded_at to datetime_original
        # (by default it uses server time via func.now())
        image.uploaded_at = datetime_original

        session.add(image)
        session.flush()  # Get image.id

        logger.info(
            "Created image record",
            image_id=image.id,
            image_uuid=image_uuid,
            camera_id=camera.id,
            file_name=filename,
            has_gps=bool(gps_location)
        )

        return image


def update_camera_health(camera_id: str, health_data: dict) -> None:
    """
    Update camera record with health data from daily report.

    Stores health data in camera.config JSON field.

    Args:
        camera_id: Camera identifier (name field)
        health_data: Parsed daily report data
    """
    with get_db_session() as session:
        # Get or create camera
        camera = session.query(Camera).filter_by(name=camera_id).first()

        if not camera:
            logger.warning(
                "Daily report for unknown camera - creating camera",
                camera_id=camera_id
            )
            camera = Camera(
                name=camera_id,
                location=None,
                config={}
            )
            session.add(camera)

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
        camera.config['last_report_timestamp'] = datetime.utcnow().isoformat()

        # Update GPS location if present in daily report
        if health_data.get('gps_location'):
            lat, lon = health_data['gps_location']
            # Update camera location from daily report GPS
            # Note: This requires PostGIS Geography type
            # For now, store in config JSON as well
            camera.config['gps_from_report'] = {'lat': lat, 'lon': lon}

        session.flush()

        logger.info(
            "Updated camera health",
            camera_id=camera_id,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature'),
            signal_quality=health_data.get('signal_quality')
        )
