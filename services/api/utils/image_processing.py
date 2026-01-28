"""
Image processing utilities for project images

Handles validation, thumbnail generation, and local file storage for project images.
"""
import os
from io import BytesIO
from typing import BinaryIO
from PIL import Image
from fastapi import UploadFile

from shared.logger import get_logger

logger = get_logger("api.image_processing")

# Constants
MAX_FILE_SIZE_MB = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
THUMBNAIL_SIZE = (256, 256)
ALLOWED_FORMATS = {"JPEG", "PNG"}
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png"}
PROJECT_IMAGES_DIR = "/app/project-images"


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
        # Open and check format (don't use verify() as it closes the file)
        img = Image.open(file.file)
        img_format = img.format

        # Check format
        if img_format not in ALLOWED_FORMATS:
            raise ValueError(
                f"Invalid image format: {img_format}. "
                f"Only JPEG and PNG are allowed."
            )

        # Load the image to ensure it's valid (without verify())
        # This will raise an exception if the image is corrupted
        img.load()

        # Reset file pointer for subsequent operations
        file.file.seek(0)
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
    Process and save project image with thumbnail to local filesystem.

    Workflow:
    1. Validate image file (format, size)
    2. Read file into memory to avoid file handle issues
    3. Save original image to local filesystem
    4. Generate and save thumbnail
    5. Return filenames

    Args:
        file: Uploaded image file
        project_id: Project ID for naming files

    Returns:
        Tuple of (image_filename, thumbnail_filename)

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

    # Step 2: Read entire file into memory to avoid file handle issues with PIL
    file.file.seek(0)
    file_content = file.file.read()
    file_buffer = BytesIO(file_content)

    # Step 3: Prepare paths
    # Simple filenames without timestamp
    file_ext = os.path.splitext(file.filename or "image.jpg")[1].lower()
    if not file_ext:
        file_ext = ".jpg"

    image_filename = f"project_{project_id}{file_ext}"
    thumbnail_filename = f"project_{project_id}_thumb.jpg"

    # Ensure directory exists
    os.makedirs(PROJECT_IMAGES_DIR, exist_ok=True)

    image_path = os.path.join(PROJECT_IMAGES_DIR, image_filename)
    thumbnail_path = os.path.join(PROJECT_IMAGES_DIR, thumbnail_filename)

    try:
        # Step 4: Save original image to filesystem
        file_buffer.seek(0)
        with open(image_path, 'wb') as f:
            f.write(file_buffer.read())

        logger.info(
            "Saved original image",
            project_id=project_id,
            file_path=image_path
        )

        # Step 5: Generate and save thumbnail
        thumbnail_buffer = BytesIO(file_content)
        thumbnail_data = generate_thumbnail(thumbnail_buffer)

        with open(thumbnail_path, 'wb') as f:
            f.write(thumbnail_data.read())

        logger.info(
            "Saved thumbnail",
            project_id=project_id,
            file_path=thumbnail_path
        )

        return (image_filename, thumbnail_filename)

    except Exception as e:
        logger.error(
            "Failed to save project image",
            project_id=project_id,
            error=str(e),
            exc_info=True
        )
        raise ValueError(f"Failed to save image: {str(e)}")


def delete_project_images(image_filename: str | None, thumbnail_filename: str | None) -> None:
    """
    Delete project images from local filesystem.

    Args:
        image_filename: Filename of original image (None if not set)
        thumbnail_filename: Filename of thumbnail (None if not set)
    """
    if not image_filename and not thumbnail_filename:
        logger.debug("No project images to delete")
        return

    try:
        if image_filename:
            image_path = os.path.join(PROJECT_IMAGES_DIR, image_filename)
            if os.path.exists(image_path):
                os.remove(image_path)
                logger.info("Deleted project image", path=image_path)

        if thumbnail_filename:
            thumbnail_path = os.path.join(PROJECT_IMAGES_DIR, thumbnail_filename)
            if os.path.exists(thumbnail_path):
                os.remove(thumbnail_path)
                logger.info("Deleted project thumbnail", path=thumbnail_path)

    except Exception as e:
        logger.error(
            "Failed to delete project images",
            image_filename=image_filename,
            thumbnail_filename=thumbnail_filename,
            error=str(e),
            exc_info=True
        )
        # Don't raise - deletion failures shouldn't crash the operation
