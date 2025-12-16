"""
MinIO storage operations
"""
import os
from datetime import datetime

from shared.storage import StorageClient, BUCKET_RAW_IMAGES
from shared.logger import get_logger

logger = get_logger("ingestion")


def upload_image_to_minio(filepath: str, camera_id: str) -> str:
    """
    Upload image to MinIO raw-images bucket.

    Path structure: {camera_id}/{year}/{month}/{filename}

    Args:
        filepath: Local path to image file
        camera_id: Camera identifier (for organizing storage)

    Returns:
        Storage path (object name in bucket)

    Example:
        >>> upload_image_to_minio("/uploads/E1000159.JPG", "861943070068027")
        "861943070068027/2025/12/E1000159.JPG"
    """
    filename = os.path.basename(filepath)
    now = datetime.utcnow()

    # Organize by camera ID, year, month
    object_path = f"{camera_id}/{now.year}/{now.month:02d}/{filename}"

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
