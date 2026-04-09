"""
FTPS Ingestion Service

Watches for new camera trap images and daily reports uploaded via FTPS,
processes them into the ML pipeline.
"""
import os
import time
import uuid
from pathlib import Path
from datetime import datetime, timedelta
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent, FileMovedEvent
from apscheduler.schedulers.background import BackgroundScheduler

from shared.logger import get_logger, set_image_id
from shared.queue import RedisQueue, QUEUE_IMAGE_INGESTED, QUEUE_NOTIFICATION_EVENTS
from shared.config import get_settings

from validators import validate_image, validate_daily_report
from exif_parser import extract_exif, get_datetime_original
from camera_profiles import identify_camera_profile
from db_operations import (
    get_camera_by_device_id,
    create_image_record,
    update_camera_health
)
from storage_operations import upload_image_to_minio, generate_and_upload_thumbnail
from daily_report_parser import parse_daily_report
from utils import ValidationError, reject_file, delete_file, is_valid_gps

# Enable PIL to load truncated images from camera traps
# Camera traps often send incomplete JPEGs over cellular connections
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

logger = get_logger("ingestion")
settings = get_settings()


def _is_under_rejected_tree(filepath: str) -> bool:
    """
    True if ``filepath`` sits under the rejected/ subtree of the upload dir.

    With the recursive watchdog observer, file events fire inside rejected/
    too (when reject_file moves a file in). This guard prevents an infinite
    loop where rejecting a file immediately re-queues it for processing.
    """
    upload_dir = settings.ftps_upload_dir or "/uploads"
    try:
        rel = Path(filepath).resolve().relative_to(Path(upload_dir).resolve())
    except ValueError:
        return False
    return bool(rel.parts) and rel.parts[0] == "rejected"


def _dispatch_file(filepath: str, base_ext: str) -> None:
    """
    Route a file to the appropriate handler based on its extension.

    ``.jpg/.jpeg`` → process_image
    ``.txt``       → process_daily_report
    ``.mp4``       → logged and deleted (no video support; avoids clogging rejected/)
    anything else  → rejected as ``unsupported_file_type``
    """
    filename = os.path.basename(filepath)

    if base_ext in ('jpg', 'jpeg'):
        process_image(filepath)
    elif base_ext == 'txt':
        process_daily_report(filepath)
    elif base_ext == 'mp4':
        logger.info(
            "Deleted unsupported video",
            file_name=filename,
            filepath=filepath,
            reason="no_video_support",
        )
        try:
            os.unlink(filepath)
        except OSError as e:
            logger.warning(
                "Failed to delete unsupported video",
                filepath=filepath,
                error=str(e),
            )
    else:
        reject_file(filepath, "unsupported_file_type", "Extension not recognized")


class IngestionEventHandler(FileSystemEventHandler):
    """
    Handles file system events in the FTPS upload directory.
    """

    def on_created(self, event: FileCreatedEvent):
        """
        Handle new file created in upload directory.

        Args:
            event: File system event
        """
        if event.is_directory:
            return

        filepath = event.src_path
        filename = os.path.basename(filepath)

        # Ignore hidden files
        if filename.startswith('.'):
            return

        # Ignore files inside the rejected/ tree (recursive observer picks them up)
        if _is_under_rejected_tree(filepath):
            return

        # Small delay to ensure file is fully written
        time.sleep(0.5)

        # Check if file still exists (might have been deleted by another process)
        if not os.path.exists(filepath):
            return

        base_ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
        _dispatch_file(filepath, base_ext)

    def on_moved(self, event: FileMovedEvent):
        """
        Handle file rename/move events from Pure-FTPd.

        Pure-FTPd's CustomerProof feature uses atomic uploads:
        1. Upload to hidden temp file: .pureftpd-upload.FILENAME
        2. Atomic rename to visible: FILENAME or FILENAME.1 (if collision)

        This handler catches the atomic rename and processes the file immediately.

        Args:
            event: File system move/rename event
        """
        if event.is_directory:
            return

        src_filename = os.path.basename(event.src_path)
        dest_filename = os.path.basename(event.dest_path)

        # Only process CustomerProof atomic uploads (hidden → visible)
        if not src_filename.startswith('.pureftpd-upload.'):
            return

        filepath = event.dest_path

        # Ignore hidden files (shouldn't happen, but defensive)
        if dest_filename.startswith('.'):
            return

        # Ignore files inside the rejected/ tree
        if _is_under_rejected_tree(filepath):
            return

        # No sleep needed - file was fully written before atomic rename

        # Route by file extension (checking base extension, not AutoRename suffix)
        # Extract last extension component (e.g., IMG.JPG.1 → jpg)
        parts = dest_filename.lower().split('.')
        base_ext = parts[-1] if len(parts) > 1 else ''

        # If extension is numeric (AutoRename suffix), use second-to-last part
        if base_ext.isdigit() and len(parts) > 2:
            base_ext = parts[-2]

        _dispatch_file(filepath, base_ext)


def strip_autorename_suffix(filename: str) -> str:
    """
    Strip Pure-FTPd AutoRename suffix from filename.

    Pure-FTPd adds .1, .2, .10, etc. on collision. We strip these
    to preserve the original camera filename in storage and database.

    Examples:
        IMG_0001.JPG → IMG_0001.JPG
        IMG_0001.JPG.1 → IMG_0001.JPG
        IMG_0001.JPG.12 → IMG_0001.JPG
        DailyReport.txt.3 → DailyReport.txt

    Args:
        filename: Filename potentially with AutoRename suffix

    Returns:
        Cleaned filename without numeric suffix
    """
    import re
    # Match: .{one or more digits} at end of filename
    # This preserves extensions like .jpg while removing .1, .2, etc.
    return re.sub(r'\.\d+$', '', filename)


def _relative_upload_path(filepath: str) -> str:
    """
    Return ``filepath`` relative to the upload directory, using ``/`` separators.

    Used for path-based profile identification. Falls back to the basename
    if the file is somehow outside the upload root.
    """
    upload_dir = settings.ftps_upload_dir or "/uploads"
    try:
        rel = Path(filepath).resolve().relative_to(Path(upload_dir).resolve())
    except ValueError:
        return os.path.basename(filepath)
    return rel.as_posix()


def process_image(filepath: str) -> None:
    """
    Process uploaded camera trap image.

    Two code paths depending on the camera profile:

    - **Path-based profile** (e.g. INSTAR): identify from the upload path,
      extract device_id / datetime / GPS from the path and filename, skip
      EXIF entirely.
    - **EXIF-based profile** (Willfine, Swift Enduro): extract EXIF, require
      Make/Model, use the profile's get_camera_id.

    Args:
        filepath: Path to image file
    """
    filename = os.path.basename(filepath)

    # Strip AutoRename suffix (.1, .2, etc.) to preserve original camera filename
    # This must be done BEFORE any filename-based processing
    clean_filename = strip_autorename_suffix(filename)
    relative_path = _relative_upload_path(filepath)

    logger.info(
        "Processing image",
        file_name=clean_filename,
        filepath=filepath,
        relative_path=relative_path,
    )

    try:
        # Step 1: Validate file (MIME, size)
        validate_image(filepath)

        # Step 2: Identify camera profile.
        #
        # Path-based profiles (INSTAR) match on the relative upload path and
        # skip EXIF entirely. EXIF-based profiles still need Make/Model, so
        # we only read EXIF when the path-based match misses.
        exif: dict = {}
        try:
            profile = identify_camera_profile(exif={}, filename=clean_filename, relative_path=relative_path)
        except ValueError:
            # No path-based profile matched. Try EXIF-based identification.
            exif = extract_exif(filepath) or {}
            if not exif:
                reject_file(
                    filepath,
                    "exif_extraction_failed",
                    "Could not extract EXIF metadata",
                    exif_metadata={}
                )
                return

            make = exif.get('Make')
            model = exif.get('Model')
            if not make and not model:
                reject_file(
                    filepath,
                    "no_camera_exif",
                    f"Image file has no camera EXIF data (Make/Model missing). "
                    f"File may have been edited or EXIF stripped. "
                    f"Basic metadata present: {list(exif.keys())}",
                    exif_metadata=exif
                )
                return

            try:
                profile = identify_camera_profile(
                    exif=exif, filename=clean_filename, relative_path=relative_path
                )
            except ValueError as e:
                reject_file(filepath, "unsupported_camera", str(e), exif_metadata=exif)
                return

        logger.info(
            "Camera profile identified",
            file_name=filename,
            profile=profile.name,
            is_path_based=profile.is_path_based,
        )

        # Step 3: Extract device_id, datetime, GPS according to the profile.
        if profile.is_path_based:
            try:
                parsed = profile.parse_path(relative_path)
            except ValueError as e:
                # Covers Test-Snapshot.jpeg and any other filename without a
                # timestamp. Route to missing_datetime so it lands next to the
                # other datetime rejections.
                reject_file(filepath, "missing_datetime", str(e))
                return

            device_id = parsed["device_id"]
            datetime_original = parsed["datetime"]
            gps_location = parsed["gps"]
            # Record the path-derived metadata in the audit trail
            exif = {"source": "path", "relative_path": relative_path}
        else:
            # EXIF-based profile (exif has already been extracted above)
            device_id = profile.get_camera_id(exif, clean_filename)
            if not device_id:
                reject_file(
                    filepath,
                    "missing_device_id",
                    f"Could not extract device ID for profile {profile.name}",
                    exif_metadata=exif
                )
                return

            try:
                datetime_original = get_datetime_original(
                    exif,
                    filepath,
                    allow_fallback=not profile.requires_datetime
                )
            except ValueError as e:
                reject_file(filepath, "missing_datetime", str(e), exif_metadata=exif)
                return

            gps_location = exif.get('gps_decimal')  # Tuple (lat, lon) or None

        # Step 4: Validate GPS (shared between both flows).
        # Reject images whose GPS is present but nonsensical, e.g. (0, 0)
        # or out-of-range. Doing this before the missing_gps check below so
        # that (0, 0) is recorded under invalid_gps, not missing_gps.
        if gps_location and not is_valid_gps(gps_location):
            reject_file(
                filepath,
                "invalid_gps",
                f"Image GPS is invalid: {gps_location}. Expected a real coordinate, not (0, 0) or out of range.",
                exif_metadata=exif
            )
            return

        if not gps_location and profile.requires_gps:
            reject_file(
                filepath,
                "missing_gps",
                f"Image has no GPS coordinates. Profile {profile.name} requires GPS for deployment tracking.",
                exif_metadata=exif
            )
            return

        # Step 5: Look up camera (returns database ID or None)
        camera_db_id = get_camera_by_device_id(device_id)
        if camera_db_id is None:
            reject_file(
                filepath,
                "unknown_camera",
                f"Camera not registered. Device ID: {device_id}. Please create camera in Camera Management before uploading files."
            )
            return

        # Step 6: Generate UUID for image
        image_uuid = str(uuid.uuid4())

        # Step 7: Upload to MinIO (using cleaned filename, device ID as folder, UUID for uniqueness)
        storage_path = upload_image_to_minio(filepath, device_id, image_uuid, clean_filename)

        # Step 8: Generate and upload thumbnail
        # Note: thumbnail generation may fail for severely corrupted images, but we
        # continue processing since the full image is already uploaded to MinIO
        try:
            thumbnail_path = generate_and_upload_thumbnail(filepath, device_id, image_uuid, clean_filename)
        except Exception as e:
            logger.warning(
                "Failed to generate thumbnail, continuing without it",
                file_name=filename,
                error=str(e),
                exc_info=True
            )
            thumbnail_path = None

        # Step 9: Create database record (with cleaned filename)
        create_image_record(
            image_uuid=image_uuid,
            camera_id=camera_db_id,
            filename=clean_filename,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            datetime_original=datetime_original,
            gps_location=gps_location,
            exif_metadata=exif
        )

        # Set correlation ID for subsequent logs
        set_image_id(image_uuid)

        # Step 10: Publish to Redis queue
        queue = RedisQueue(QUEUE_IMAGE_INGESTED)
        queue.publish({
            'image_uuid': image_uuid,
            'storage_path': storage_path,
            'camera_id': camera_db_id,
        })

        logger.info(
            "Image ingestion complete",
            image_uuid=image_uuid,
            device_id=device_id,
            file_name=clean_filename,
            queued=True
        )

        # Step 11: Delete original file
        delete_file(filepath)

    except ValidationError as e:
        # Validation failed - reject file
        reject_file(filepath, "validation_failed", str(e))

    except Exception as e:
        # Unexpected error - crash loudly (don't delete file)
        logger.error(
            "Image processing failed",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        raise


def process_daily_report(filepath: str) -> None:
    """
    Process uploaded daily report.

    Workflow:
    1. Validate file (size only)
    2. Parse daily report
    3. Extract camera ID
    4. Update camera health in database
    5. Delete original file

    Args:
        filepath: Path to daily report file
    """
    filename = os.path.basename(filepath)

    # Strip AutoRename suffix (.1, .2, etc.) to preserve original camera filename
    clean_filename = strip_autorename_suffix(filename)

    logger.info("Processing daily report", file_name=clean_filename)

    try:
        # Step 1: Validate file
        validate_daily_report(filepath)

        # Step 2: Parse daily report
        try:
            health_data = parse_daily_report(filepath)
        except ValueError as e:
            reject_file(filepath, "parse_failed", str(e))
            return

        # Step 3: Extract device ID (camera_id field from daily report is the device ID)
        device_id = health_data['camera_id']

        # Step 4: Update camera health (only if camera exists)
        camera_updated = update_camera_health(device_id, health_data)

        if not camera_updated:
            reject_file(
                filepath,
                "unknown_camera",
                f"Camera not registered. Device ID: {device_id}. Please create camera in Camera Management before uploading files."
            )
            return

        logger.info(
            "Daily report processed",
            device_id=device_id,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature')
        )

        # Battery notifications are handled by daily digest (see notifications service)

        # Step 4: Delete original file
        delete_file(filepath)

    except ValidationError as e:
        # Validation failed - reject file
        reject_file(filepath, "validation_failed", str(e))

    except Exception as e:
        # Unexpected error - crash loudly (don't delete file)
        logger.error(
            "Daily report processing failed",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        raise


def cleanup_old_rejected_files() -> None:
    """
    Clean up rejected files older than 30 days.

    Runs daily at midnight UTC to remove old rejected files and their
    error logs to prevent disk space issues.
    """
    upload_dir = settings.ftps_upload_dir or "/uploads"
    rejected_base = Path(upload_dir) / "rejected"

    if not rejected_base.exists():
        logger.debug("Rejected directory does not exist, skipping cleanup")
        return

    cutoff_time = datetime.now() - timedelta(days=30)
    cutoff_timestamp = cutoff_time.timestamp()

    deleted_count = 0

    # Iterate through all rejection reason directories
    for reason_dir in rejected_base.iterdir():
        if not reason_dir.is_dir():
            continue

        # Check all files in this reason directory
        for file_path in reason_dir.iterdir():
            if not file_path.is_file():
                continue

            try:
                # Get file modification time
                file_mtime = file_path.stat().st_mtime

                # Skip if file is newer than 30 days
                if file_mtime >= cutoff_timestamp:
                    continue

                # Calculate age in days
                age_days = (datetime.now().timestamp() - file_mtime) / 86400

                # Delete the file
                file_path.unlink()
                deleted_count += 1

                logger.info(
                    "Deleted old rejected file",
                    filename=file_path.name,
                    reason=reason_dir.name,
                    age_days=round(age_days, 1)
                )

            except Exception as e:
                logger.error(
                    "Failed to delete old rejected file",
                    filepath=str(file_path),
                    error=str(e)
                )

    if deleted_count > 0:
        logger.info(
            "Cleanup completed",
            deleted_count=deleted_count,
            retention_days=30
        )
    else:
        logger.debug("Cleanup completed, no old files found")


def main():
    """
    Main entry point for ingestion service.
    """
    upload_dir = settings.ftps_upload_dir or "/uploads"

    # Ensure upload directory exists
    Path(upload_dir).mkdir(parents=True, exist_ok=True)

    # Create rejected subdirectories
    rejected_base = Path(upload_dir) / "rejected"
    for reason in [
        "mime_type",
        "file_size",
        "no_camera_exif",
        "unsupported_camera",
        "missing_device_id",
        "missing_datetime",
        "missing_gps",
        "validation_failed",
        "parse_failed",
        "exif_extraction_failed",
        "unsupported_file_type",
        "conversion_failed"  # TEMPORARY: for Willfine-2024 conversion failures
    ]:
        (rejected_base / reason).mkdir(parents=True, exist_ok=True)

    logger.info(
        "Ingestion service starting",
        upload_dir=upload_dir,
        log_level=settings.log_level
    )

    # Process any existing files in the upload directory (from before service start).
    # Recursive scan picks up nested camera trees (e.g. INSTAR/<lat-lon>/<date>/images/),
    # but the rejected/ subtree is excluded so we never re-process old rejections.
    upload_path = Path(upload_dir)

    def _is_under_rejected(path: Path) -> bool:
        try:
            rel_parts = path.relative_to(upload_path).parts
        except ValueError:
            return False
        return bool(rel_parts) and rel_parts[0] == "rejected"

    existing_files = [
        f for f in upload_path.rglob('*')
        if f.is_file() and not _is_under_rejected(f) and not f.name.startswith('.')
    ]
    existing_images = [f for f in existing_files if f.suffix.lower() in ['.jpg', '.jpeg']]
    existing_reports = [f for f in existing_files if f.suffix.lower() == '.txt']
    existing_videos = [f for f in existing_files if f.suffix.lower() == '.mp4']

    if existing_images or existing_reports or existing_videos:
        logger.info(
            "Processing existing files from upload directory",
            num_images=len(existing_images),
            num_reports=len(existing_reports),
            num_videos=len(existing_videos)
        )

        for image_file in existing_images:
            try:
                process_image(str(image_file))
            except Exception as e:
                logger.error(
                    "Failed to process existing image",
                    file_name=image_file.name,
                    error=str(e),
                    exc_info=True
                )

        for report_file in existing_reports:
            try:
                process_daily_report(str(report_file))
            except Exception as e:
                logger.error(
                    "Failed to process existing report",
                    file_name=report_file.name,
                    error=str(e),
                    exc_info=True
                )

        for video_file in existing_videos:
            # Same policy as the dispatcher: log and delete.
            logger.info(
                "Deleted unsupported video",
                file_name=video_file.name,
                filepath=str(video_file),
                reason="no_video_support",
            )
            try:
                video_file.unlink()
            except OSError as e:
                logger.warning(
                    "Failed to delete unsupported video",
                    filepath=str(video_file),
                    error=str(e),
                )

    # Set up recursive file system observer.
    # Recursive mode is required so cameras that upload into nested directories
    # (e.g. INSTAR's /custom-path/<date>/images/) are picked up. The on_created
    # and on_moved handlers exclude the rejected/ subtree to avoid event loops.
    event_handler = IngestionEventHandler()
    observer = Observer()
    observer.schedule(event_handler, upload_dir, recursive=True)
    observer.start()

    # Set up daily cleanup scheduler
    scheduler = BackgroundScheduler(timezone='UTC')
    scheduler.add_job(
        cleanup_old_rejected_files,
        'cron',
        hour=0,
        minute=0,
        id='cleanup_rejected_files',
        name='Clean up rejected files older than 30 days'
    )
    scheduler.start()

    logger.info(
        "Watching for new files",
        directory=upload_dir,
        cleanup_schedule="daily at 00:00 UTC"
    )

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down ingestion service")
        observer.stop()
        observer.join()
        scheduler.shutdown()
        logger.info("Ingestion service stopped")


if __name__ == "__main__":
    main()
