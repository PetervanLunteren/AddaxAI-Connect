"""
Populate camera GPS locations from image EXIF data.

This script simulates daily reports by taking the average GPS location
from each camera's images and setting it as the camera's location.
"""
import json
import sys
from datetime import datetime, timezone
from typing import Optional, Tuple
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger

settings = get_settings()
logger = get_logger("populate_camera_gps")


def parse_gps_json(gps_str: Optional[str]) -> Optional[Tuple[float, float]]:
    """
    Parse GPS from JSON string format "[lat, lon]"

    Args:
        gps_str: GPS string like "[52.106, 5.361]"

    Returns:
        Tuple of (lat, lon) or None
    """
    if not gps_str:
        return None

    try:
        gps_list = json.loads(gps_str)
        if len(gps_list) == 2:
            lat, lon = float(gps_list[0]), float(gps_list[1])
            # Filter out invalid coordinates (0.0, 0.0)
            if lat == 0.0 and lon == 0.0:
                return None
            return (lat, lon)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning(f"Failed to parse GPS: {gps_str}", error=str(e))

    return None


def calculate_camera_gps_centroids(session: Session):
    """
    Calculate average GPS location for each camera from its images.

    Returns:
        Dict mapping camera_id to (avg_lat, avg_lon)
    """
    # Query all images with GPS data grouped by camera
    query = text("""
        SELECT
            camera_id,
            image_metadata->>'gps_decimal' as gps
        FROM images
        WHERE image_metadata->>'gps_decimal' IS NOT NULL
        ORDER BY camera_id
    """)

    result = session.execute(query)

    # Group by camera and calculate average
    camera_gps = {}

    for row in result:
        camera_id = row.camera_id
        gps = parse_gps_json(row.gps)

        if gps:
            if camera_id not in camera_gps:
                camera_gps[camera_id] = []
            camera_gps[camera_id].append(gps)

    # Calculate averages
    camera_centroids = {}
    for camera_id, gps_list in camera_gps.items():
        if gps_list:
            avg_lat = sum(lat for lat, lon in gps_list) / len(gps_list)
            avg_lon = sum(lon for lat, lon in gps_list) / len(gps_list)
            camera_centroids[camera_id] = (avg_lat, avg_lon)
            logger.info(
                f"Camera {camera_id}: calculated centroid from {len(gps_list)} images",
                camera_id=camera_id,
                lat=avg_lat,
                lon=avg_lon,
                image_count=len(gps_list)
            )

    return camera_centroids


def update_camera_location(session: Session, camera_id: int, lat: float, lon: float):
    """
    Update camera location in PostGIS format and config.

    Args:
        session: Database session
        camera_id: Camera ID
        lat: Latitude
        lon: Longitude
    """
    # PostGIS uses lon,lat order (x,y)
    location_wkt = f"POINT({lon} {lat})"

    # First, get existing config
    query_get = text("SELECT config FROM cameras WHERE id = :camera_id")
    result = session.execute(query_get, {'camera_id': camera_id})
    row = result.fetchone()

    existing_config = row[0] if row and row[0] else {}

    # Merge with new GPS data
    updated_config = {**existing_config}
    updated_config['gps_from_report'] = {'lat': lat, 'lon': lon}
    updated_config['last_report_timestamp'] = datetime.now(timezone.utc).isoformat()

    # Update camera with PostGIS location and merged config
    query_update = text("""
        UPDATE cameras
        SET
            location = ST_GeogFromText(:location_wkt),
            config = :config,
            last_daily_report_at = :timestamp,
            last_seen = :timestamp
        WHERE id = :camera_id
    """)

    session.execute(
        query_update,
        {
            'location_wkt': location_wkt,
            'config': json.dumps(updated_config),
            'timestamp': datetime.now(timezone.utc),
            'camera_id': camera_id
        }
    )

    logger.info(
        f"Updated camera {camera_id} location",
        camera_id=camera_id,
        lat=lat,
        lon=lon
    )


def main():
    """Main execution"""
    logger.info("Starting camera GPS population from image data")

    # Create database connection
    engine = create_engine(settings.database_url)

    with Session(engine) as session:
        # Calculate GPS centroids for all cameras
        camera_centroids = calculate_camera_gps_centroids(session)

        if not camera_centroids:
            logger.warning("No cameras with GPS data found")
            return

        logger.info(f"Found {len(camera_centroids)} cameras with GPS data")

        # Update each camera
        for camera_id, (lat, lon) in camera_centroids.items():
            update_camera_location(session, camera_id, lat, lon)

        # Commit all changes
        session.commit()
        logger.info("Successfully updated all camera locations")

        # Verify results
        verify_query = text("""
            SELECT
                id,
                name,
                ST_AsText(location) as location_wkt,
                config->>'gps_from_report' as gps_from_report
            FROM cameras
            WHERE location IS NOT NULL
            ORDER BY id
        """)

        result = session.execute(verify_query)
        logger.info("Verification - cameras with locations:")
        for row in result:
            logger.info(
                f"  Camera {row.id} ({row.name}): {row.location_wkt}",
                camera_id=row.id,
                name=row.name,
                location=row.location_wkt
            )


if __name__ == "__main__":
    main()
