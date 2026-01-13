"""
Image handler for downloading attachments from MinIO
"""
from shared.logger import get_logger
from shared.storage import StorageClient

logger = get_logger("notifications-signal.images")


def download_image_from_minio(storage_path: str) -> bytes:
    """
    Download image from MinIO.

    Args:
        storage_path: Full MinIO path (e.g., "thumbnails/12345/image.jpg")
                     or object key only (e.g., "12345/image.jpg" - defaults to thumbnails bucket)

    Returns:
        Image bytes

    Raises:
        Exception: If download fails
    """
    # Parse bucket and object key from storage_path
    # Format: "bucket/object/key" or just "object/key" (defaults to thumbnails)
    parts = storage_path.split('/', 1)

    # Check if first part is a valid bucket name
    valid_buckets = ['raw-images', 'crops', 'thumbnails', 'models', 'project-images']

    if len(parts) == 2 and parts[0] in valid_buckets:
        # Path includes bucket name
        bucket_name = parts[0]
        object_key = parts[1]
    else:
        # Path is just the object key, use thumbnails bucket
        bucket_name = 'thumbnails'
        object_key = storage_path

    logger.debug("Downloading image from MinIO", bucket=bucket_name, key=object_key)

    try:
        storage = StorageClient()
        image_bytes = storage.download_fileobj(bucket_name, object_key)

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
