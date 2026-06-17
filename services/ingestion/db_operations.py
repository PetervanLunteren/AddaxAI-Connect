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
from shared.models import Camera, Deployment, CameraHealthReport, Image, Rejection, ServerSettings
from shared.logger import get_logger
from shared.geo import (
    SITE_THRESHOLD_METERS,
    RELOCATION_CONFIRMATIONS,
    RECOMPUTE_SITE_LOCATION_SQL,
)
from utils import is_valid_gps

logger = get_logger("ingestion")

# A camera that moves more than SITE_THRESHOLD_METERS leaves its current site, so
# a new deployment starts. One threshold, defined in shared.geo. Deriving the
# deployment fully from a Site row is Phase 2 of the site work; for now this
# distance check is equivalent because both use the same value.


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
        camera = session.query(Camera).filter_by(device_id=device_id).first()

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


def create_rejection_record(
    disk_path: str,
    filename: str,
    reason: str,
    details: Optional[str] = None,
    device_id: Optional[str] = None,
    captured_at: Optional[datetime] = None,
    exif_metadata: Optional[dict] = None,
) -> None:
    """
    Record a rejected file so the Live feed can show it without scanning disk.

    Resolves camera_id and project_id from device_id where possible. The camera
    lookup runs here (not at the call site) because most rejections happen before
    ingestion's own camera lookup. project_id stays None when device_id is missing
    or the camera is not registered, so the row never appears in a project feed.

    Args:
        disk_path: Absolute path of the moved file in the rejected/ tree
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
            camera = session.query(Camera).filter_by(device_id=device_id).first()
            if camera:
                camera_id = camera.id
                project_id = camera.project_id

        rejection = Rejection(
            filename=filename,
            disk_path=disk_path,
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


def _resolve_site(
    session,
    project_id: Optional[int],
    lat: float,
    lon: float,
    camera_id: Optional[int] = None,
) -> Optional[int]:
    """
    Return the id of the site within SITE_THRESHOLD_METERS of (lat, lon) in this
    project, creating one if none is close enough. Returns None when the camera
    has no project, since sites are project-scoped (the deployment then stays
    site-less, matching the pre-site behaviour).

    Per-camera affinity: when camera_id is given, first reuse the most recent
    site this camera has used that is within the threshold of (lat, lon), even if
    another site is nearer. This keeps co-located cameras apart, two cameras on
    one pole pointing different ways share a GPS point, so plain nearest-site
    would flip between their sites; the camera's own history is the tiebreak.
    Only the initial collapse still needs a one-time manual split; after that the
    assignment sticks across GPS glitches and re-deployments.
    """
    if project_id is None:
        return None

    wkt = f"POINT({lon} {lat})"

    if camera_id is not None:
        own = session.execute(
            text("""
                SELECT d.site_id
                FROM deployments d
                JOIN sites s ON s.id = d.site_id
                WHERE d.camera_id = :camera_id
                  AND d.site_id IS NOT NULL
                  AND ST_Distance(s.location, ST_GeogFromText(:wkt)) <= :threshold
                ORDER BY d.deployment_number DESC
                LIMIT 1
            """),
            {"wkt": wkt, "camera_id": camera_id, "threshold": SITE_THRESHOLD_METERS},
        ).fetchone()
        if own:
            return own.site_id

    nearest = session.execute(
        text("""
            SELECT id, ST_Distance(location, ST_GeogFromText(:wkt)) AS dist
            FROM sites
            WHERE project_id = :project_id
            ORDER BY dist
            LIMIT 1
        """),
        {"wkt": wkt, "project_id": project_id},
    ).fetchone()

    if nearest and nearest.dist <= SITE_THRESHOLD_METERS:
        return nearest.id

    site_id = session.execute(
        text("""
            INSERT INTO sites (uuid, project_id, name, location, created_at)
            VALUES (:uuid, :project_id, :name, ST_GeogFromText(:wkt), now())
            RETURNING id
        """),
        {
            "uuid": str(uuid.uuid4()),
            "project_id": project_id,
            "name": f"Site at {lat:.4f}, {lon:.4f}",
            "wkt": wkt,
        },
    ).scalar_one()
    logger.info(
        "Auto-created site",
        site_id=site_id,
        project_id=project_id,
        location=f"({lat:.6f}, {lon:.6f})",
    )
    return site_id


def _recompute_site_location(session, site_id: Optional[int]) -> None:
    """Reset a site's pin to the centroid of its deployments. No-op when site_id
    is None or the site has no deployments."""
    if site_id is None:
        return
    session.execute(text(RECOMPUTE_SITE_LOCATION_SQL), {"site_id": site_id})


def _insert_deployment(session, camera_id: int, number: int, site_id: Optional[int],
                       start_date: date, lat: float, lon: float,
                       end_date: Optional[date] = None) -> int:
    """Insert a deployment and return its id. end_date NULL means still open."""
    return session.execute(
        text("""
            INSERT INTO deployments (
                camera_id, deployment_number, site_id, start_date, end_date, location
            ) VALUES (
                :camera_id, :number, :site_id, :start_date, :end_date, ST_GeogFromText(:wkt)
            )
            RETURNING id
        """),
        {
            "camera_id": camera_id,
            "number": number,
            "site_id": site_id,
            "start_date": start_date,
            "end_date": end_date,
            "wkt": f"POINT({lon} {lat})",
        },
    ).scalar_one()


def update_or_create_site_and_deployment(
    camera_id: int,
    new_gps: Tuple[float, float],
    event_date: date,
    allow_relocation: bool = True,
) -> Tuple[Optional[int], int]:
    """
    Resolve the site and deployment for a new GPS reading and return
    (site_id, deployment_id).

    One distance rule governs both (SITE_THRESHOLD_METERS, from shared.geo):
    a reading more than that far from the camera's active deployment means the
    camera left its site, so the active deployment is closed and a new one opens
    at the resolved site. Within the threshold it is the same deployment. Sites
    are reused when an existing one in the project is within the threshold,
    otherwise one is auto-created. site_id is None only when the camera has no
    project, since sites are project-scoped.

    allow_relocation gates the split: photos pass True (a photo is the evidence a
    deployment is built from). Daily health reports pass False, because a report
    carries GPS but no photo, so a report must never move a camera between sites
    or split its deployment, it would only leave behind a deployment with zero
    images. A report still creates the first deployment when none is active and
    still heals a missing site within the threshold.

    Raises:
        ValueError: invalid GPS (None, (0, 0), out of range), or unknown camera.
    """
    # Defensive guard: callers pre-validate, but raise loudly so no future
    # caller can insert a (0, 0) zombie.
    if not is_valid_gps(new_gps):
        raise ValueError(f"Invalid GPS for camera {camera_id}: {new_gps}")

    new_lat, new_lon = new_gps

    with get_db_session() as session:
        camera = session.query(Camera).filter(Camera.id == camera_id).first()
        if camera is None:
            raise ValueError(f"Unknown camera {camera_id}")
        project_id = camera.project_id

        config = camera.config or {}

        # Current active deployment (end_date IS NULL), if any.
        active = session.query(Deployment).filter(
            and_(Deployment.camera_id == camera_id, Deployment.end_date.is_(None))
        ).first()

        # By default the new deployment (if one is created below) starts on this
        # event's date. A debounced relocation overrides this with the first
        # out-of-range date so the new deployment covers the held reading.
        new_start_date = event_date

        if active is not None:
            loc = session.execute(
                text("""
                    SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
                    FROM deployments WHERE id = :dep_pk
                """),
                {"dep_pk": active.id},
            ).fetchone()
            distance = calculate_gps_distance(loc.lat, loc.lon, new_lat, new_lon)

            if distance <= SITE_THRESHOLD_METERS:
                # Same place, same deployment. The camera is back within range,
                # so any pending relocation candidate was a transient outlier:
                # clear it.
                if config.pop('gps_relocation_candidate', None) is not None:
                    camera.config = config
                    flag_modified(camera, 'config')
                # Heal a missing site (legacy deployments that predate the site
                # work) from the current GPS. site_source is only a label of who
                # set the site, it does not gate this.
                if active.site_id is None:
                    active.site_id = _resolve_site(session, project_id, new_lat, new_lon, camera_id)
                    session.flush()
                    _recompute_site_location(session, active.site_id)
                if event_date < active.start_date:
                    logger.info(
                        "Backdating deployment start_date for out-of-order image",
                        camera_id=camera_id,
                        deployment_number=active.deployment_number,
                        old_start=str(active.start_date),
                        new_start=str(event_date),
                    )
                    active.start_date = event_date
                session.flush()
                logger.debug(
                    "GPS within threshold - same deployment",
                    camera_id=camera_id,
                    deployment_number=active.deployment_number,
                    site_id=active.site_id,
                    distance_meters=round(distance, 1),
                )
                return (active.site_id, active.id)

            # Beyond the site, but this reading is not allowed to relocate the
            # camera (a daily report: GPS without a photo). Leave the active
            # deployment where it is and do not start a relocation candidate;
            # only photos move a camera between sites.
            if not allow_relocation:
                logger.info(
                    "Out-of-range report GPS ignored (reports do not relocate)",
                    camera_id=camera_id,
                    deployment_number=active.deployment_number,
                    distance_meters=round(distance, 1),
                )
                return (active.site_id, active.id)

            # Beyond the site: a single bad GPS fix should not split the
            # deployment and spawn a phantom site. Debounce: require
            # RELOCATION_CONFIRMATIONS consecutive out-of-range readings near the
            # same new spot before believing the camera moved.
            candidate = config.get('gps_relocation_candidate')
            near_candidate = (
                candidate is not None
                and calculate_gps_distance(
                    candidate['lat'], candidate['lon'], new_lat, new_lon
                ) <= SITE_THRESHOLD_METERS
            )
            if near_candidate:
                count = candidate['count'] + 1
                first_date = date.fromisoformat(candidate['date'])
            else:
                count = 1
                first_date = event_date

            if count < RELOCATION_CONFIRMATIONS:
                # Not confirmed yet: hold this reading on the current deployment
                # (do not move its point) and remember the candidate.
                config['gps_relocation_candidate'] = {
                    'lat': new_lat,
                    'lon': new_lon,
                    'date': first_date.isoformat(),
                    'count': count,
                }
                camera.config = config
                flag_modified(camera, 'config')
                session.flush()
                logger.info(
                    "Out-of-range GPS held pending relocation confirmation",
                    camera_id=camera_id,
                    deployment_number=active.deployment_number,
                    distance_meters=round(distance, 1),
                    count=count,
                )
                return (active.site_id, active.id)

            # Confirmed relocation: clear the candidate and split, backdating the
            # new deployment to the first out-of-range reading so it covers the
            # held image. Clamp the close so it never predates the old start.
            config.pop('gps_relocation_candidate', None)
            camera.config = config
            flag_modified(camera, 'config')
            active.end_date = max(first_date - timedelta(days=1), active.start_date)
            next_number = active.deployment_number + 1
            new_start_date = first_date
            log_msg = "Camera relocated - creating new deployment"
        else:
            max_number = session.query(
                func.max(Deployment.deployment_number)
            ).filter(Deployment.camera_id == camera_id).scalar()
            next_number = 1 if max_number is None else max_number + 1
            log_msg = "Creating new deployment for camera"

        site_id = _resolve_site(session, project_id, new_lat, new_lon, camera_id)
        deployment_id = _insert_deployment(
            session, camera_id, next_number, site_id, new_start_date, new_lat, new_lon
        )
        session.flush()
        _recompute_site_location(session, site_id)
        logger.info(
            log_msg,
            camera_id=camera_id,
            deployment_number=next_number,
            site_id=site_id,
            location=f"({new_lat:.6f}, {new_lon:.6f})",
        )
        return (site_id, deployment_id)


def get_or_create_bulk_deployment(
    camera_id: int,
    site_id: int,
    start_date: Optional[date],
    end_date: Optional[date],
) -> int:
    """
    Resolve the single deployment a bulk batch should attach to.

    A bulk batch is conceptually one camera at one site for a date range. Reuse
    the camera's existing deployment at this site if there is one (widening its
    date range to cover the batch); otherwise create a closed deployment at the
    site spanning [start_date, end_date]. Returns the deployment id.

    Unlike live ingestion this does not touch the camera's active deployment, so
    importing an old SD card never disturbs where the camera is reported now.
    """
    with get_db_session() as session:
        loc = session.execute(
            text("""
                SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon
                FROM sites WHERE id = :site_id
            """),
            {"site_id": site_id},
        ).fetchone()
        if loc is None:
            raise ValueError(f"Site {site_id} not found")

        existing = session.query(Deployment).filter(
            and_(Deployment.camera_id == camera_id, Deployment.site_id == site_id)
        ).order_by(Deployment.deployment_number).first()

        if existing is not None:
            if start_date and start_date < existing.start_date:
                existing.start_date = start_date
            if end_date and existing.end_date and end_date > existing.end_date:
                existing.end_date = end_date
            session.flush()
            return existing.id

        max_number = session.query(
            func.max(Deployment.deployment_number)
        ).filter(Deployment.camera_id == camera_id).scalar()
        next_number = 1 if max_number is None else max_number + 1
        deployment_id = _insert_deployment(
            session, camera_id, next_number, site_id,
            start_date or date.today(), loc.lat, loc.lon, end_date=end_date,
        )
        session.flush()
        logger.info(
            "Created bulk deployment for site",
            camera_id=camera_id,
            site_id=site_id,
            deployment_number=next_number,
        )
        return deployment_id


def create_image_record(
    image_uuid: str,
    camera_id: int,
    filename: str,
    storage_path: str,
    thumbnail_path: str,
    captured_at: datetime,
    gps_location: Optional[Tuple[float, float]],
    exif_metadata: dict,
    origin: str = "live",
    content_hash: Optional[str] = None,
    bulk_upload_job_id: Optional[int] = None,
    deployment_id: Optional[int] = None,
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
        gps_location: (latitude, longitude) or None
        exif_metadata: Full EXIF data dictionary
        origin: 'live' for FTPS-ingested, 'bulk' for SD-card upload. Drives
            notification suppression downstream (bulk skips species_detection).
        content_hash: Optional SHA-256 hex of raw bytes. Used by bulk upload
            to deduplicate re-imports of the same SD card.

    Returns:
        Image UUID (string)
    """
    # When the caller already knows the deployment (a bulk batch pinned to a
    # chosen site), use it as-is. Otherwise resolve site and deployment from
    # GPS, which covers live ingestion and bulk uploads with no chosen site.
    # Done before the image session because the resolver manages its own session.
    if deployment_id is None and gps_location:
        _, deployment_id = update_or_create_site_and_deployment(
            camera_id=camera_id,
            new_gps=gps_location,
            event_date=captured_at.date(),
        )

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
            origin=origin,
            content_hash=content_hash,
            bulk_upload_job_id=bulk_upload_job_id,
            deployment_id=deployment_id,
        )

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

    # Update site and deployment if daily report has valid GPS. Health data
    # (battery, temperature) is the file's main payload and is already saved
    # above, so an invalid GPS is logged and skipped, not file-rejected.
    # (done outside session context since the function manages its own session)
    report_gps = health_data.get('gps_location')
    if is_valid_gps(report_gps):
        update_or_create_site_and_deployment(
            camera_id=camera_id,
            new_gps=report_gps,
            event_date=datetime.now(timezone.utc).date(),
            allow_relocation=False,
        )
    elif report_gps is not None:
        logger.warning(
            "Daily report has invalid GPS, skipping deployment update",
            device_id=device_id,
            gps=report_gps,
        )

    return True
