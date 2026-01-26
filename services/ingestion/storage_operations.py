"""
MinIO storage operations
"""
import os
from datetime import datetime, timezone
from PIL import Image
from io import BytesIO

from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS
from shared.logger import get_logger

logger = get_logger("ingestion")


def upload_image_to_minio(filepath: str, camera_id: str, image_uuid: str) -> str:
    """
    Upload image to MinIO raw-images bucket.

    Path structure: {camera_id}/{year}/{month}/{uuid}_{filename}

    Args:
        filepath: Local path to image file
        camera_id: Camera identifier (for organizing storage)
        image_uuid: UUID for the image (prevents filename collisions)

    Returns:
        Storage path (object name in bucket)

    Example:
        >>> upload_image_to_minio("/uploads/E1000159.JPG", "861943070068027", "abc-123")
        "861943070068027/2025/12/abc-123_E1000159.JPG"
    """
    filename = os.path.basename(filepath)
    now = datetime.now(timezone.utc)

    # Organize by camera ID, year, month, with UUID prefix to prevent collisions
    object_path = f"{camera_id}/{now.year}/{now.month:02d}/{image_uuid}_{filename}"

    # Upload to MinIO
    storage = StorageClient()
    storage.upload_file(
        file_path=filepath,
        bucket=BUCKET_RAW_IMAGES,
        object_name=object_path
    )

    logger.info(
        "Uploaded image to MinIO",
        file_name=filename,
        camera_id=camera_id,
        storage_path=object_path
    )

    return object_path


def generate_and_upload_thumbnail(filepath: str, camera_id: str, image_uuid: str) -> str:
    """
    Generate thumbnail and upload to MinIO thumbnails bucket.

    Resizes image to 300px width (preserving aspect ratio), 85% JPEG quality.
    Uses same path structure as raw images for consistency.

    Args:
        filepath: Local path to image file
        camera_id: Camera identifier (for organizing storage)
        image_uuid: UUID for the image (prevents filename collisions)

    Returns:
        Thumbnail storage path (object name in bucket)

    Example:
        >>> generate_and_upload_thumbnail("/uploads/E1000159.JPG", "861943070068027", "abc-123")
        "861943070068027/2025/12/abc-123_E1000159.JPG"
    """
    filename = os.path.basename(filepath)
    now = datetime.now(timezone.utc)

    # Organize by camera ID, year, month, with UUID prefix (same structure as raw images)
    object_path = f"{camera_id}/{now.year}/{now.month:02d}/{image_uuid}_{filename}"

    try:
        # Load and resize image
        with Image.open(filepath) as img:
            # Convert to RGB (handles RGBA, grayscale, etc.)
            if img.mode != 'RGB':
                img = img.convert('RGB')

            # Calculate new dimensions (300px width, preserve aspect ratio)
            thumbnail_width = 300
            aspect_ratio = img.height / img.width
            thumbnail_height = int(thumbnail_width * aspect_ratio)

            # Resize with high-quality downsampling
            thumbnail = img.resize(
                (thumbnail_width, thumbnail_height),
                Image.Resampling.LANCZOS
            )

            # Save to BytesIO buffer
            buffer = BytesIO()
            thumbnail.save(buffer, format='JPEG', quality=85, optimize=True)
            buffer.seek(0)

            # Upload to MinIO
            storage = StorageClient()
            storage.upload_fileobj(
                file_obj=buffer,
                bucket=BUCKET_THUMBNAILS,
                object_name=object_path
            )

            logger.info(
                "Generated and uploaded thumbnail",
                file_name=filename,
                camera_id=camera_id,
                thumbnail_path=object_path,
                thumbnail_size=f"{thumbnail_width}x{thumbnail_height}"
            )

            return object_path

    except Exception as e:
        logger.error(
            "Failed to generate thumbnail",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        raise
