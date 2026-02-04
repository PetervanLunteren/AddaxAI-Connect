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
    battery_threshold: int = 30,
    sd_threshold: int = 80
) -> Dict[str, Any]:
    """
    Get camera health summary for project.

    Args:
        db: Database session
        project_id: Project to query
        battery_threshold: Battery % below which camera is considered low
        sd_threshold: SD card % above which camera is considered full

    Returns:
        Dictionary with:
        - total: Total cameras in project
        - active: Cameras with recent activity (7 days)
        - inactive: Cameras without recent activity
        - low_battery_count: Cameras below battery threshold
        - low_battery_cameras: List of {'name': str, 'battery': int}
        - high_sd_count: Cameras above SD threshold
        - high_sd_cameras: List of {'name': str, 'sd_percent': int}
    """
    cameras = db.execute(
        select(Camera).where(Camera.project_id == project_id)
    ).scalars().all()

    total = len(cameras)
    active = 0
    inactive_cameras = []
    never_reported_cameras = []
    low_battery_cameras = []
    high_sd_cameras = []
    battery_values = []
    sd_values = []

    cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)

    for camera in cameras:
        # Check if camera has never reported (use status field)
        if camera.status == 'never_reported':
            never_reported_cameras.append({'name': camera.name})
            continue

        # Check activity status for cameras that have reported before
        is_active = False
        if camera.last_daily_report_at:
            if camera.last_daily_report_at >= cutoff_date:
                is_active = True
        elif camera.config and camera.config.get('last_report_timestamp'):
            try:
                last_report = datetime.fromisoformat(camera.config['last_report_timestamp'])
                if last_report >= cutoff_date:
                    is_active = True
            except (ValueError, TypeError):
                pass

        if is_active:
            active += 1
        else:
            inactive_cameras.append({'name': camera.name})

        # Check battery - first try direct column, then config
        battery = camera.battery_percent
        if battery is None and camera.config:
            health = camera.config.get('last_health_report', {})
            battery = health.get('battery_percentage')

        if battery is not None:
            battery_values.append(battery)
            if battery <= battery_threshold:
                low_battery_cameras.append({
                    'name': camera.name,
                    'battery': battery
                })

        # Check SD card usage - first try direct columns, then config
        sd_percent = None
        if camera.sd_used_mb is not None and camera.sd_total_mb is not None and camera.sd_total_mb > 0:
            sd_percent = int((camera.sd_used_mb / camera.sd_total_mb) * 100)
        elif camera.config:
            health = camera.config.get('last_health_report', {})
            sd_percent = health.get('sd_utilization_percentage')
            if sd_percent is not None:
                sd_percent = int(sd_percent)

        if sd_percent is not None:
            # Invert: raw data is "space left", we want "space used"
            sd_used = 100 - sd_percent
            sd_values.append(sd_used)
            if sd_used >= sd_threshold:
                high_sd_cameras.append({
                    'name': camera.name,
                    'sd_percent': sd_used
                })

    # Calculate averages
    avg_battery = int(sum(battery_values) / len(battery_values)) if battery_values else 0
    avg_sd = int(sum(sd_values) / len(sd_values)) if sd_values else 0

    return {
        'total': total,
        'active': active,
        'inactive': len(inactive_cameras),
        'inactive_cameras': inactive_cameras,
        'never_reported': len(never_reported_cameras),
        'never_reported_cameras': never_reported_cameras,
        'low_battery_count': len(low_battery_cameras),
        'low_battery_cameras': sorted(low_battery_cameras, key=lambda x: x['battery']),
        'high_sd_count': len(high_sd_cameras),
        'high_sd_cameras': sorted(high_sd_cameras, key=lambda x: -x['sd_percent']),
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

    # Get hourly distribution - count classifications (not raw detections)
    # This ensures consistency with species counts
    query = (
        select(
            func.extract('hour', Image.uploaded_at).label('hour'),
            func.count(Classification.id).label('count')
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
