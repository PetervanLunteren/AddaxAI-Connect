"""
Statistics queries for email reports.

Uses synchronous database sessions for scheduled job compatibility.
All queries are filtered by project_id for per-project reports.
"""
from typing import Dict, Any, List, Optional
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select, func, and_, desc
from sqlalchemy.orm import Session

from shared.models import (
    Image, Camera, Detection, Classification, Project
)
from shared.logger import get_logger

logger = get_logger("notifications.report_stats")


def get_overview_stats(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date
) -> Dict[str, Any]:
    """
    Get overview statistics for date range.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)

    Returns:
        Dictionary with:
        - total_images: All-time total images
        - new_images: Images in date range
        - total_cameras: Cameras in project
        - total_species: Unique species detected (all-time)
        - new_species: Species first detected in date range
    """
    # Convert dates to datetime for comparison
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    # Get project detection threshold
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    detection_threshold = project.detection_threshold if project else 0.5

    # Total images (all-time)
    total_images = db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(Camera.project_id == project_id)
    ).scalar_one()

    # New images in period
    new_images = db.execute(
        select(func.count(Image.id))
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
    ).scalar_one()

    # Total cameras
    total_cameras = db.execute(
        select(func.count(Camera.id))
        .where(Camera.project_id == project_id)
    ).scalar_one()

    # Total unique species (all-time, above threshold)
    total_species = db.execute(
        select(func.count(func.distinct(Classification.species)))
        .join(Detection)
        .join(Image)
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold
            )
        )
    ).scalar_one()

    # Species first detected in period
    # Find species where min(upload_date) falls within the period
    all_species_first_seen = db.execute(
        select(
            Classification.species,
            func.min(Image.uploaded_at).label('first_seen')
        )
        .select_from(Classification)
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold
            )
        )
        .group_by(Classification.species)
    ).all()

    new_species_count = sum(
        1 for species, first_seen in all_species_first_seen
        if first_seen and start_dt <= first_seen <= end_dt
    )

    return {
        'total_images': total_images,
        'new_images': new_images,
        'total_cameras': total_cameras,
        'total_species': total_species,
        'new_species': new_species_count
    }


def get_species_distribution(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Get top species by detection count for date range.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)
        limit: Max species to return

    Returns:
        List of {'species': str, 'count': int} sorted by count descending
    """
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    # Get project detection threshold
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    detection_threshold = project.detection_threshold if project else 0.5

    query = (
        select(
            Classification.species,
            func.count(Classification.id).label('count')
        )
        .join(Detection)
        .join(Image)
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
        .group_by(Classification.species)
        .order_by(desc('count'))
        .limit(limit)
    )

    rows = db.execute(query).all()

    return [
        {'species': row.species, 'count': row.count}
        for row in rows
    ]


def get_camera_health_summary(
    db: Session,
    project_id: int,
    battery_threshold: int = 30
) -> Dict[str, Any]:
    """
    Get camera health summary for project.

    Args:
        db: Database session
        project_id: Project to query
        battery_threshold: Battery % below which camera is considered low

    Returns:
        Dictionary with:
        - total: Total cameras in project
        - active: Cameras with recent activity (7 days)
        - inactive: Cameras without recent activity
        - low_battery_count: Cameras below battery threshold
        - low_battery_cameras: List of {'name': str, 'battery': int}
    """
    cameras = db.execute(
        select(Camera).where(Camera.project_id == project_id)
    ).scalars().all()

    total = len(cameras)
    active = 0
    inactive = 0
    never_reported = 0
    low_battery_cameras = []
    battery_values = []
    sd_values = []

    cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)

    for camera in cameras:
        # Check activity status
        if camera.last_daily_report_at:
            if camera.last_daily_report_at >= cutoff_date:
                active += 1
            else:
                inactive += 1
        elif camera.config and camera.config.get('last_report_timestamp'):
            try:
                last_report = datetime.fromisoformat(camera.config['last_report_timestamp'])
                if last_report >= cutoff_date:
                    active += 1
                else:
                    inactive += 1
            except (ValueError, TypeError):
                never_reported += 1
        else:
            never_reported += 1

        # Check battery
        if camera.battery_percent is not None:
            battery_values.append(camera.battery_percent)
            if camera.battery_percent <= battery_threshold:
                low_battery_cameras.append({
                    'name': camera.name,
                    'battery': camera.battery_percent
                })

        # Check SD card usage
        if camera.sd_used_mb is not None and camera.sd_total_mb is not None and camera.sd_total_mb > 0:
            sd_percent = int((camera.sd_used_mb / camera.sd_total_mb) * 100)
            sd_values.append(sd_percent)

    # Calculate averages
    avg_battery = int(sum(battery_values) / len(battery_values)) if battery_values else 0
    avg_sd = int(sum(sd_values) / len(sd_values)) if sd_values else 0

    return {
        'total': total,
        'active': active,
        'inactive': inactive + never_reported,
        'low_battery_count': len(low_battery_cameras),
        'low_battery_cameras': sorted(low_battery_cameras, key=lambda x: x['battery']),
        'avg_battery': avg_battery,
        'avg_sd': avg_sd
    }


def get_notable_detections(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date,
    limit: int = 5
) -> List[Dict[str, Any]]:
    """
    Get notable detections for the period (high confidence or rare species).

    Selects detections with highest confidence scores.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)
        limit: Max detections to return

    Returns:
        List of detection details with species, camera, timestamp, confidence
    """
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    # Get project detection threshold
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    detection_threshold = project.detection_threshold if project else 0.5

    query = (
        select(
            Classification.species,
            Classification.confidence.label('classification_confidence'),
            Detection.confidence.label('detection_confidence'),
            Camera.name.label('camera_name'),
            Image.uploaded_at,
            Image.uuid.label('image_uuid')
        )
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
        .order_by(desc(Classification.confidence))
        .limit(limit)
    )

    rows = db.execute(query).all()

    return [
        {
            'species': row.species,
            'camera': row.camera_name,
            'timestamp': row.uploaded_at.isoformat() if row.uploaded_at else None,
            'confidence': round(row.classification_confidence * 100, 1),
            'image_uuid': row.image_uuid
        }
        for row in rows
    ]


def get_activity_summary(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date
) -> Dict[str, Any]:
    """
    Get activity pattern summary for the period.

    Analyzes hourly detection distribution to find peak activity times.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)

    Returns:
        Dictionary with:
        - total_detections: Total detections in period
        - peak_hour: Hour with most activity (0-23)
        - hourly_distribution: List of 24 counts
    """
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    # Get project detection threshold
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    detection_threshold = project.detection_threshold if project else 0.5

    # Get hourly distribution
    # Using EXIF DateTimeOriginal from image_metadata if available, otherwise uploaded_at
    query = (
        select(
            func.extract('hour', Image.uploaded_at).label('hour'),
            func.count(Detection.id).label('count')
        )
        .join(Detection, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
        .group_by(func.extract('hour', Image.uploaded_at))
    )

    rows = db.execute(query).all()

    # Build 24-hour distribution
    hourly_distribution = [0] * 24
    for row in rows:
        if row.hour is not None:
            hourly_distribution[int(row.hour)] = row.count

    total_detections = sum(hourly_distribution)
    peak_hour = hourly_distribution.index(max(hourly_distribution)) if total_detections > 0 else None

    return {
        'total_detections': total_detections,
        'peak_hour': peak_hour,
        'hourly_distribution': hourly_distribution
    }


def get_hero_detection(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date,
    domain: str
) -> Optional[Dict[str, Any]]:
    """
    Get the best (highest confidence) detection for the period.

    This becomes the "hero" image featured at the top of the email report.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)
        domain: Domain name for constructing image URLs

    Returns:
        Dictionary with species, confidence, camera, timestamp, image_url
        or None if no detections found
    """
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    # Get project detection threshold
    project = db.execute(
        select(Project).where(Project.id == project_id)
    ).scalar_one_or_none()
    detection_threshold = project.detection_threshold if project else 0.5

    query = (
        select(
            Classification.species,
            Classification.confidence.label('classification_confidence'),
            Camera.name.label('camera_name'),
            Image.uploaded_at,
            Image.uuid.label('image_uuid')
        )
        .select_from(Classification)
        .join(Detection, Classification.detection_id == Detection.id)
        .join(Image, Detection.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Camera.project_id == project_id,
                Detection.confidence >= detection_threshold,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
        .order_by(desc(Classification.confidence))
        .limit(1)
    )

    row = db.execute(query).first()

    if not row:
        return None

    # Format timestamp for display
    timestamp_str = None
    if row.uploaded_at:
        timestamp_str = row.uploaded_at.strftime('%b %d, %Y at %H:%M')

    # Construct image URL (public thumbnail for email)
    # Add cache-busting parameter to avoid Gmail proxy caching issues
    import time
    cache_bust = int(time.time())
    image_url = f"https://{domain}/api/images/{row.image_uuid}/thumbnail/public?v={cache_bust}"

    return {
        'species': row.species,
        'confidence': round(row.classification_confidence * 100, 1),
        'camera': row.camera_name,
        'timestamp': timestamp_str,
        'image_url': image_url,
        'image_uuid': row.image_uuid
    }


def get_images_timeline(
    db: Session,
    project_id: int,
    start_date: date,
    end_date: date
) -> List[Dict[str, Any]]:
    """
    Get daily image counts for the period.

    Args:
        db: Database session
        project_id: Project to query
        start_date: Start of period (inclusive)
        end_date: End of period (inclusive)

    Returns:
        List of {'date': str, 'count': int} sorted by date
    """
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=timezone.utc)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=timezone.utc)

    query = (
        select(
            func.date(Image.uploaded_at).label('date'),
            func.count(Image.id).label('count')
        )
        .join(Camera)
        .where(
            and_(
                Camera.project_id == project_id,
                Image.uploaded_at >= start_dt,
                Image.uploaded_at <= end_dt
            )
        )
        .group_by(func.date(Image.uploaded_at))
        .order_by(func.date(Image.uploaded_at))
    )

    rows = db.execute(query).all()

    return [
        {'date': row.date.isoformat(), 'count': row.count}
        for row in rows
    ]
