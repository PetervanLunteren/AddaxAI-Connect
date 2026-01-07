"""
Image handler for downloading attachments from MinIO
"""
from io import BytesIO

from shared.logger import get_logger
from shared.storage import get_minio_client

logger = get_logger("notifications-signal.images")


def download_image_from_minio(storage_path: str) -> bytes:
    """
    Download image from MinIO.

    Args:
        storage_path: Full MinIO path (e.g., "thumbnails/12345/image.jpg")

    Returns:
        Image bytes

    Raises:
        Exception: If download fails
    """
    # Parse bucket and object key from storage_path
    # Format: "bucket/object/key"
    parts = storage_path.split('/', 1)
    if len(parts) != 2:
        raise ValueError(f"Invalid storage path format: {storage_path}")

    bucket_name = parts[0]
    object_key = parts[1]

    logger.debug("Downloading image from MinIO", bucket=bucket_name, key=object_key)

    try:
        client = get_minio_client()

        # Download image
        response = client.get_object(bucket_name, object_key)
        image_bytes = response.read()
        response.close()
        response.release_conn()

        logger.debug(
            "Downloaded image",
            bucket=bucket_name,
            key=object_key,
            size_bytes=len(image_bytes)
        )

        return image_bytes

    except Exception as e:
        logger.error(
            "Failed to download image from MinIO",
            bucket=bucket_name,
            key=object_key,
            error=str(e)
        )
        raise
