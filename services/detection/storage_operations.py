"""
MinIO storage operations for detection worker

Handles downloading images and uploading crops.
"""
from pathlib import Path
from tempfile import NamedTemporaryFile

from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS
from shared.logger import get_logger

logger = get_logger("detection.storage")


def download_image_from_minio(storage_path: str) -> str:
    """
    Download image from MinIO to temporary file.

    Args:
        storage_path: Path in MinIO (e.g., "camera123/image.jpg")

    Returns:
        Path to downloaded temporary file

    Raises:
        Exception: If download fails
    """
    logger.info("Downloading image from MinIO", storage_path=storage_path)

    try:
        storage = StorageClient()

        # Create temporary file
        temp_file = NamedTemporaryFile(delete=False, suffix=".jpg")
        temp_path = temp_file.name
        temp_file.close()

        # Download from MinIO
        storage.download_file(BUCKET_RAW_IMAGES, storage_path, temp_path)

        logger.info("Image downloaded", storage_path=storage_path, local_path=temp_path)
        return temp_path

    except Exception as e:
        logger.error(
            "Image download failed",
            storage_path=storage_path,
            error=str(e),
            exc_info=True
        )
        raise


def upload_crop_to_minio(local_path: str, crop_filename: str) -> str:
    """
    Upload crop to MinIO crops bucket.

    Args:
        local_path: Path to local crop file
        crop_filename: Filename for crop in MinIO

    Returns:
        Storage path in MinIO

    Raises:
        Exception: If upload fails
    """
    logger.info("Uploading crop to MinIO", crop_filename=crop_filename)

    try:
        storage = StorageClient()

        # Upload to crops bucket
        storage.upload_file(local_path, BUCKET_CROPS, crop_filename)

        storage_path = crop_filename
        logger.info("Crop uploaded", storage_path=storage_path)

        return storage_path

    except Exception as e:
        logger.error(
            "Crop upload failed",
            crop_filename=crop_filename,
            error=str(e),
            exc_info=True
        )
        raise
