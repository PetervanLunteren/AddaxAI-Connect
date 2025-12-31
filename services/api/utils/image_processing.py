"""
Image processing utilities for project images

Handles validation, thumbnail generation, and MinIO upload for project images.
"""
import os
import tempfile
from io import BytesIO
from typing import BinaryIO
from PIL import Image
from fastapi import UploadFile

from shared.storage import StorageClient, BUCKET_PROJECT_IMAGES
from shared.logger import get_logger

logger = get_logger("api.image_processing")

# Constants
MAX_FILE_SIZE_MB = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
THUMBNAIL_SIZE = (256, 256)
ALLOWED_FORMATS = {"JPEG", "PNG"}
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}


def validate_image_file(file: UploadFile) -> None:
    """
    Validate uploaded image file.

    Args:
        file: Uploaded file from FastAPI

    Raises:
        ValueError: If file is invalid (format, size, etc.)
    """
    # Check MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise ValueError(
            f"Invalid file type: {file.content_type}. "
            f"Only JPEG and PNG images are allowed."
        )

    # Check file size by reading the file
    file.file.seek(0, os.SEEK_END)
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to beginning

    if file_size > MAX_FILE_SIZE_BYTES:
        size_mb = file_size / (1024 * 1024)
        raise ValueError(
            f"File size ({size_mb:.1f}MB) exceeds maximum allowed size ({MAX_FILE_SIZE_MB}MB)"
        )

    # Validate it's actually an image by trying to open with Pillow
    try:
        img = Image.open(file.file)
        img_format = img.format  # Store format before verify() closes the file
        img.verify()  # Verify it's a valid image (this closes the file)

        # Check format
        if img_format not in ALLOWED_FORMATS:
            raise ValueError(
                f"Invalid image format: {img_format}. "
                f"Only JPEG and PNG are allowed."
            )

        # Reopen the file since verify() closed it
        file.file.seek(0)
        img = Image.open(file.file)
        file.file.seek(0)  # Reset to beginning for subsequent operations
    except Exception as e:
        raise ValueError(f"Invalid or corrupted image file: {str(e)}")


def generate_thumbnail(image_file: BinaryIO, size: tuple[int, int] = THUMBNAIL_SIZE) -> BytesIO:
    """
    Generate thumbnail from image file.

    Maintains aspect ratio and adds padding if needed to ensure square output.

    Args:
        image_file: File-like object containing image data
        size: Thumbnail dimensions (width, height)

    Returns:
        BytesIO object containing thumbnail JPEG data

    Raises:
        ValueError: If thumbnail generation fails
    """
    try:
        # Open image
        img = Image.open(image_file)

        # Convert to RGB if necessary (handles PNG with transparency, etc.)
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')

        # Calculate aspect-ratio-preserving size
        img.thumbnail(size, Image.Resampling.LANCZOS)

        # Create square canvas with padding (black background)
        thumb = Image.new('RGB', size, (0, 0, 0))

        # Paste image centered
        offset = ((size[0] - img.width) // 2, (size[1] - img.height) // 2)
        thumb.paste(img, offset)

        # Save to BytesIO
        output = BytesIO()
        thumb.save(output, format='JPEG', quality=85, optimize=True)
        output.seek(0)

        return output

    except Exception as e:
        raise ValueError(f"Failed to generate thumbnail: {str(e)}")


def process_and_upload_project_image(file: UploadFile, project_id: int) -> tuple[str, str]:
    """
    Process and upload project image with thumbnail.

    Workflow:
    1. Validate image file (format, size)
    2. Upload original image to MinIO
    3. Generate and upload thumbnail
    4. Return storage paths

    Args:
        file: Uploaded image file
        project_id: Project ID for organizing storage

    Returns:
        Tuple of (image_path, thumbnail_path) in MinIO

    Raises:
        ValueError: If validation or processing fails
    """
    logger.info(
        "Processing project image",
        project_id=project_id,
        file_name=file.filename,
        content_type=file.content_type
    )

    # Step 1: Validate
    validate_image_file(file)

    # Step 2: Prepare paths
    # Use safe filename (just extension, not original name for security)
    file_ext = os.path.splitext(file.filename or "image.jpg")[1].lower()
    if not file_ext:
        file_ext = ".jpg"

    image_filename = f"project_{project_id}{file_ext}"
    thumbnail_filename = f"project_{project_id}_thumb.jpg"

    image_path = f"{project_id}/{image_filename}"
    thumbnail_path = f"{project_id}/{thumbnail_filename}"

    storage = StorageClient()

    try:
        # Step 3: Upload original image
        file.file.seek(0)
        storage.upload_fileobj(
            file_obj=file.file,
            bucket=BUCKET_PROJECT_IMAGES,
            object_name=image_path
        )

        logger.info(
            "Uploaded original image",
            project_id=project_id,
            storage_path=image_path
        )

        # Step 4: Generate and upload thumbnail
        file.file.seek(0)
        thumbnail_data = generate_thumbnail(file.file)

        storage.upload_fileobj(
            file_obj=thumbnail_data,
            bucket=BUCKET_PROJECT_IMAGES,
            object_name=thumbnail_path
        )

        logger.info(
            "Uploaded thumbnail",
            project_id=project_id,
            storage_path=thumbnail_path
        )

        return (image_path, thumbnail_path)

    except Exception as e:
        logger.error(
            "Failed to upload project image",
            project_id=project_id,
            error=str(e),
            exc_info=True
        )
        raise ValueError(f"Failed to upload image: {str(e)}")


def delete_project_images(image_path: str | None, thumbnail_path: str | None) -> None:
    """
    Delete project images from MinIO.

    Args:
        image_path: Path to original image in MinIO (None if not set)
        thumbnail_path: Path to thumbnail in MinIO (None if not set)
    """
    if not image_path and not thumbnail_path:
        logger.debug("No project images to delete")
        return

    storage = StorageClient()

    try:
        if image_path:
            storage.delete_object(BUCKET_PROJECT_IMAGES, image_path)
            logger.info("Deleted project image", path=image_path)

        if thumbnail_path:
            storage.delete_object(BUCKET_PROJECT_IMAGES, thumbnail_path)
            logger.info("Deleted project thumbnail", path=thumbnail_path)

    except Exception as e:
        logger.error(
            "Failed to delete project images",
            image_path=image_path,
            thumbnail_path=thumbnail_path,
            error=str(e),
            exc_info=True
        )
        # Don't raise - deletion failures shouldn't crash the operation
