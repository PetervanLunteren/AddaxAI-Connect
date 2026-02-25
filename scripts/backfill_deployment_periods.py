"""
Backfill camera deployment periods from historical image data.

This script analyzes existing images with GPS data and creates deployment period
records, detecting camera relocations (>100m GPS change).

Run once after adding camera_deployment_periods table.

Usage:
    python backfill_deployment_periods.py
"""
import json
import sys
from datetime import date, datetime
from typing import List, Optional, Tuple
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

# Add parent directory to path for imports
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger
from shared.models import CameraDeploymentPeriod

settings = get_settings()
logger = get_logger("backfill_deployments")

# Constants
RELOCATION_THRESHOLD_METERS = 100.0  # GPS change >100m = new deployment


def parse_gps_json(gps_str: Optional[str]) -> Optional[Tuple[float, float]]:
    """
    Parse GPS from JSON string format "[lat, lon]"

    Args:
        gps_str: GPS string like "[52.106, 5.361]"

    Returns:
        Tuple of (lat, lon) or None if invalid

    Raises:
        ValueError: If GPS format is invalid (not parseable)
    """
    if not gps_str:
        return None

    try:
        gps_list = json.loads(gps_str)
        if not isinstance(gps_list, list) or len(gps_list) != 2:
            raise ValueError(f"GPS must be array of 2 numbers, got: {gps_str}")

        lat, lon = float(gps_list[0]), float(gps_list[1])

        # Filter out invalid coordinates (0.0, 0.0)
        if lat == 0.0 and lon == 0.0:
            logger.warning(f"Skipping invalid GPS coordinates: {gps_str}")
            return None

        return (lat, lon)

    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.error(f"Failed to parse GPS: {gps_str}", error=str(e))
        # Don't crash - log and skip invalid GPS
        return None


def get_camera_images_with_gps(session: Session) -> dict:
    """
    Get all images with GPS data grouped by camera.

    Args:
        session: Database session

    Returns:
        Dict mapping camera_id to list of (image_date, lat, lon) tuples sorted by date

    Raises:
        RuntimeError: If database query fails
    """
    logger.info("Fetching images with GPS data from database")

    query = text("""
        SELECT
            camera_id,
            COALESCE(
                -- Convert EXIF date format "YYYY:MM:DD HH:MM:SS" to PostgreSQL timestamp
                TO_DATE(SPLIT_PART(image_metadata->>'DateTimeOriginal', ' ', 1), 'YYYY:MM:DD'),
                uploaded_at::date
            ) as image_date,
            image_metadata->>'gps_decimal' as gps
        FROM images
        WHERE image_metadata->>'gps_decimal' IS NOT NULL
        ORDER BY camera_id, image_date
    """)

    try:
        result = session.execute(query)
    except Exception as e:
        raise RuntimeError(f"Failed to query images: {str(e)}")

    # Group by camera
    camera_images = {}

    for row in result:
        camera_id = row.camera_id
        image_date = row.image_date
        gps = parse_gps_json(row.gps)

        if not gps:
            continue  # Skip invalid GPS

        if camera_id not in camera_images:
            camera_images[camera_id] = []

        camera_images[camera_id].append((image_date, gps[0], gps[1]))

    logger.info(f"Found {len(camera_images)} cameras with GPS data")
    return camera_images


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
    import math

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


def detect_deployment_periods(
    camera_id: int,
    images: List[Tuple[date, float, float]]
) -> List[dict]:
    """
    Detect deployment periods by clustering images by GPS location.

    GPS change >100m triggers new deployment period.

    Args:
        camera_id: Camera ID
        images: List of (image_date, lat, lon) tuples sorted by date

    Returns:
        List of deployment period dicts with keys:
            - deployment_id: Sequential number (1, 2, 3...)
            - start_date: First image date
            - end_date: Last image date
            - lat: Average latitude
            - lon: Average longitude

    Raises:
        ValueError: If images list is empty or contains invalid data
    """
    if not images:
        raise ValueError(f"Camera {camera_id} has no images - should not call this function")

    deployments = []
    current_deployment = {
        'deployment_id': 1,
        'start_date': images[0][0],
        'end_date': images[0][0],
        'lat_sum': images[0][1],
        'lon_sum': images[0][2],
        'count': 1,
        'last_lat': images[0][1],
        'last_lon': images[0][2],
    }

    for image_date, lat, lon in images[1:]:
        # Calculate distance from last GPS point in current deployment
        distance = calculate_gps_distance(
            current_deployment['last_lat'],
            current_deployment['last_lon'],
            lat,
            lon
        )

        if distance > RELOCATION_THRESHOLD_METERS:
            # Camera relocated - close current deployment and start new one
            deployments.append({
                'deployment_id': current_deployment['deployment_id'],
                'start_date': current_deployment['start_date'],
                'end_date': current_deployment['end_date'],
                'lat': current_deployment['lat_sum'] / current_deployment['count'],
                'lon': current_deployment['lon_sum'] / current_deployment['count'],
            })

            logger.info(
                f"Camera {camera_id} relocated",
                camera_id=camera_id,
                deployment_id=current_deployment['deployment_id'],
                distance_meters=round(distance, 1),
                old_location=f"({current_deployment['last_lat']:.6f}, {current_deployment['last_lon']:.6f})",
                new_location=f"({lat:.6f}, {lon:.6f})"
            )

            # Start new deployment
            current_deployment = {
                'deployment_id': current_deployment['deployment_id'] + 1,
                'start_date': image_date,
                'end_date': image_date,
                'lat_sum': lat,
                'lon_sum': lon,
                'count': 1,
                'last_lat': lat,
                'last_lon': lon,
            }
        else:
            # Same deployment - update end date and average location
            current_deployment['end_date'] = image_date
            current_deployment['lat_sum'] += lat
            current_deployment['lon_sum'] += lon
            current_deployment['count'] += 1
            current_deployment['last_lat'] = lat
            current_deployment['last_lon'] = lon

    # Add final deployment
    deployments.append({
        'deployment_id': current_deployment['deployment_id'],
        'start_date': current_deployment['start_date'],
        'end_date': current_deployment['end_date'],
        'lat': current_deployment['lat_sum'] / current_deployment['count'],
        'lon': current_deployment['lon_sum'] / current_deployment['count'],
    })

    logger.info(
        f"Camera {camera_id}: detected {len(deployments)} deployment periods",
        camera_id=camera_id,
        deployment_count=len(deployments)
    )

    return deployments


def create_deployment_record(
    session: Session,
    camera_id: int,
    deployment: dict
) -> None:
    """
    Create deployment period record in database.

    Args:
        session: Database session
        camera_id: Camera ID
        deployment: Deployment dict with deployment_id, start_date, end_date, lat, lon

    Raises:
        ValueError: If deployment data is invalid
        RuntimeError: If database insert fails
    """
    # Validate data
    if not isinstance(deployment['deployment_id'], int) or deployment['deployment_id'] < 1:
        raise ValueError(f"Invalid deployment_id: {deployment['deployment_id']}")

    # PostGIS uses lon,lat order (x,y)
    location_wkt = f"POINT({deployment['lon']} {deployment['lat']})"

    query = text("""
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
            :end_date,
            ST_GeogFromText(:location_wkt)
        )
    """)

    try:
        session.execute(
            query,
            {
                'camera_id': camera_id,
                'deployment_id': deployment['deployment_id'],
                'start_date': deployment['start_date'],
                'end_date': deployment['end_date'],
                'location_wkt': location_wkt,
            }
        )
    except Exception as e:
        raise RuntimeError(f"Failed to insert deployment: {str(e)}")

    logger.debug(
        f"Created deployment record",
        camera_id=camera_id,
        deployment_id=deployment['deployment_id'],
        start_date=str(deployment['start_date']),
        end_date=str(deployment['end_date']),
        trap_days=(deployment['end_date'] - deployment['start_date']).days + 1
    )


def main() -> None:
    """Main execution"""
    logger.info("Starting deployment period backfill")

    # Create database connection
    engine = create_engine(settings.database_url)

    with Session(engine) as session:
        # Skip cameras that already have deployment records
        existing = session.execute(
            text("SELECT DISTINCT camera_id FROM camera_deployment_periods")
        )
        existing_camera_ids = {row[0] for row in existing}

        # Get all camera images with GPS
        camera_images = get_camera_images_with_gps(session)

        if not camera_images:
            logger.warning("No cameras with GPS data found - nothing to backfill")
            return

        # Filter out cameras that already have deployment records
        cameras_to_process = {
            cid: imgs for cid, imgs in camera_images.items()
            if cid not in existing_camera_ids
        }

        if not cameras_to_process:
            logger.info("All cameras already have deployment records - nothing to backfill")
            return

        if existing_camera_ids:
            logger.info(
                f"Skipping {len(existing_camera_ids)} cameras that already have deployment records"
            )

        # Process each camera
        total_deployments = 0

        for camera_id, images in cameras_to_process.items():
            logger.info(
                f"Processing camera {camera_id}",
                camera_id=camera_id,
                image_count=len(images)
            )

            # Detect deployment periods
            deployments = detect_deployment_periods(camera_id, images)

            # Create database records
            for deployment in deployments:
                create_deployment_record(session, camera_id, deployment)
                total_deployments += 1

        # Commit all changes
        session.commit()

        logger.info(
            "Deployment period backfill complete",
            total_cameras=len(cameras_to_process),
            total_deployments=total_deployments
        )

        # Verification query
        verify_query = text("""
            SELECT
                camera_id,
                COUNT(*) as deployment_count,
                MIN(start_date) as earliest_date,
                MAX(COALESCE(end_date, CURRENT_DATE)) as latest_date
            FROM camera_deployment_periods
            GROUP BY camera_id
            ORDER BY camera_id
        """)

        result = session.execute(verify_query)
        logger.info("Verification - deployments per camera:")
        for row in result:
            logger.info(
                f"  Camera {row.camera_id}: {row.deployment_count} deployments, {row.earliest_date} to {row.latest_date}"
            )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.error("Backfill failed", error=str(e), exc_info=True)
        sys.exit(1)
