"""
MinIO storage operations for classification worker

Handles downloading full images from MinIO for classification.
"""
import os
from tempfile import NamedTemporaryFile
from minio import Minio

from shared.logger import get_logger
from config import get_settings

logger = get_logger("classification.storage_operations")
settings = get_settings()

# Initialize MinIO client
minio_client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=False
)


def download_image_from_minio(storage_path: str) -> str:
    """
    Download image from MinIO to temporary file.

    Args:
        storage_path: MinIO object path within raw-images bucket (format: "camera/year/month/image.jpg")

    Returns:
        str: Path to temporary file

    Raises:
        Exception: If download fails
    """
    logger.info("Downloading image from MinIO", storage_path=storage_path)

    try:
        # Images are stored in the raw-images bucket
        bucket_name = "raw-images"
        object_name = storage_path

        # Create temporary file
        temp_file = NamedTemporaryFile(delete=False, suffix=".jpg")
        temp_path = temp_file.name
        temp_file.close()

        # Download from MinIO
        minio_client.fget_object(bucket_name, object_name, temp_path)

        logger.info(
            "Image downloaded successfully",
            storage_path=storage_path,
            temp_path=temp_path,
            size_mb=round(os.path.getsize(temp_path) / 1024 / 1024, 2)
        )

        return temp_path

    except Exception as e:
        logger.error(
            "Image download failed",
            storage_path=storage_path,
            error=str(e),
            exc_info=True
        )
        raise
