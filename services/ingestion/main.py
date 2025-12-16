"""
FTPS Ingestion Service

Watches for new camera trap images and daily reports uploaded via FTPS,
processes them into the ML pipeline.
"""
import os
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent

from shared.logger import get_logger, set_image_id
from shared.queue import RedisQueue, QUEUE_IMAGE_INGESTED
from shared.config import get_settings

from .validators import validate_image, validate_daily_report
from .exif_parser import extract_exif, get_datetime_original
from .camera_profiles import identify_camera_profile
from .db_operations import (
    get_or_create_camera,
    check_duplicate_image,
    create_image_record,
    update_camera_health
)
from .storage_operations import upload_image_to_minio
from .daily_report_parser import parse_daily_report
from .utils import ValidationError, reject_file, delete_file

logger = get_logger("ingestion")
settings = get_settings()


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

        # Small delay to ensure file is fully written
        time.sleep(0.5)

        # Route by file extension
        if filename.lower().endswith(('.jpg', '.jpeg')):
            process_image(filepath)
        elif filename.lower().endswith('.txt'):
            process_daily_report(filepath)
        else:
            reject_file(filepath, "unsupported_file_type", f"Extension not recognized")


def process_image(filepath: str) -> None:
    """
    Process uploaded camera trap image.

    Workflow:
    1. Validate file (MIME type, size)
    2. Extract EXIF metadata
    3. Identify camera profile
    4. Extract camera ID
    5. Check for duplicates
    6. Upload to MinIO
    7. Create database record
    8. Publish to Redis queue
    9. Delete original file

    Args:
        filepath: Path to image file
    """
    filename = os.path.basename(filepath)

    logger.info("Processing image", filename=filename, filepath=filepath)

    try:
        # Step 1: Validate file
        validate_image(filepath)

        # Step 2: Extract EXIF
        exif = extract_exif(filepath)
        if not exif:
            reject_file(
                filepath,
                "exif_extraction_failed",
                "Could not extract EXIF metadata"
            )
            return

        # Step 3: Identify camera profile
        try:
            profile = identify_camera_profile(exif, filename)
        except ValueError as e:
            reject_file(filepath, "unsupported_camera", str(e))
            return

        logger.info("Camera profile identified", filename=filename, profile=profile.name)

        # Step 4: Extract camera ID
        camera_id = profile.get_camera_id(exif, filename)
        if not camera_id:
            reject_file(
                filepath,
                "missing_camera_id",
                f"Could not extract camera ID for profile {profile.name}"
            )
            return

        # Step 5: Get datetime (with fallback for SY cameras)
        try:
            datetime_original = get_datetime_original(
                exif,
                filepath,
                allow_fallback=not profile.requires_datetime
            )
        except ValueError as e:
            reject_file(filepath, "missing_datetime", str(e))
            return

        # Step 6: Get or create camera
        camera = get_or_create_camera(camera_id, profile)

        # Step 7: Check for duplicates
        if check_duplicate_image(camera.id, filename, datetime_original):
            reject_file(
                filepath,
                "duplicate",
                f"Image already exists: camera={camera_id}, file={filename}, datetime={datetime_original}"
            )
            return

        # Step 8: Extract GPS if present
        gps_location = exif.get('gps_decimal')  # Tuple (lat, lon) or None

        # Step 9: Upload to MinIO
        storage_path = upload_image_to_minio(filepath, camera_id)

        # Step 10: Create database record
        image = create_image_record(
            camera=camera,
            filename=filename,
            storage_path=storage_path,
            datetime_original=datetime_original,
            gps_location=gps_location,
            exif_metadata=exif
        )

        # Set correlation ID for subsequent logs
        set_image_id(str(image.id))

        # Step 11: Publish to Redis queue
        queue = RedisQueue(QUEUE_IMAGE_INGESTED)
        queue.publish({
            'image_id': image.id,
            'storage_path': storage_path,
            'camera_id': camera.id,
        })

        logger.info(
            "Image ingestion complete",
            image_id=image.id,
            camera_id=camera_id,
            filename=filename,
            queued=True
        )

        # Step 12: Delete original file
        delete_file(filepath)

    except ValidationError as e:
        # Validation failed - reject file
        reject_file(filepath, "validation_failed", str(e))

    except Exception as e:
        # Unexpected error - crash loudly (don't delete file)
        logger.error(
            "Image processing failed",
            filename=filename,
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

    logger.info("Processing daily report", filename=filename)

    try:
        # Step 1: Validate file
        validate_daily_report(filepath)

        # Step 2: Parse daily report
        try:
            health_data = parse_daily_report(filepath)
        except ValueError as e:
            reject_file(filepath, "parse_failed", str(e))
            return

        camera_id = health_data['camera_id']

        # Step 3: Update camera health
        update_camera_health(camera_id, health_data)

        logger.info(
            "Daily report processed",
            camera_id=camera_id,
            battery=health_data.get('battery_percentage'),
            temperature=health_data.get('temperature')
        )

        # Step 4: Delete original file
        delete_file(filepath)

    except ValidationError as e:
        # Validation failed - reject file
        reject_file(filepath, "validation_failed", str(e))

    except Exception as e:
        # Unexpected error - crash loudly (don't delete file)
        logger.error(
            "Daily report processing failed",
            filename=filename,
            error=str(e),
            exc_info=True
        )
        raise


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
        "unsupported_camera",
        "missing_camera_id",
        "missing_datetime",
        "duplicate",
        "validation_failed",
        "parse_failed",
        "exif_extraction_failed",
        "unsupported_file_type"
    ]:
        (rejected_base / reason).mkdir(parents=True, exist_ok=True)

    logger.info(
        "Ingestion service starting",
        upload_dir=upload_dir,
        log_level=settings.log_level
    )

    # Set up file system observer
    event_handler = IngestionEventHandler()
    observer = Observer()
    observer.schedule(event_handler, upload_dir, recursive=False)
    observer.start()

    logger.info("Watching for new files", directory=upload_dir)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down ingestion service")
        observer.stop()
        observer.join()


if __name__ == "__main__":
    main()
