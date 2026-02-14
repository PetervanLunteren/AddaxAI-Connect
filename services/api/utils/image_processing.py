"""
Image processing utilities for project images

Handles validation, thumbnail generation, and local file storage for project images.
"""
import os
from io import BytesIO
from typing import BinaryIO, List
from PIL import Image, ImageFilter
from fastapi import UploadFile

from shared.logger import get_logger

logger = get_logger("api.image_processing")

# Constants
MAX_FILE_SIZE_MB = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024
THUMBNAIL_MAX_WIDTH = 512  # Max width, maintains aspect ratio
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


def generate_thumbnail(image_file: BinaryIO, max_width: int = THUMBNAIL_MAX_WIDTH) -> BytesIO:
    """
    Generate thumbnail from image file.

    Maintains original aspect ratio (camera trap dimensions).
    Resizes to max_width while preserving aspect ratio.

    Args:
        image_file: File-like object containing image data
        max_width: Maximum width in pixels (height scales proportionally)

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

        # Calculate new dimensions maintaining aspect ratio
        aspect_ratio = img.height / img.width
        new_width = min(max_width, img.width)  # Don't upscale
        new_height = int(new_width * aspect_ratio)

        # Resize with high-quality resampling
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Save to BytesIO with high quality
        output = BytesIO()
        img.save(output, format='JPEG', quality=95, optimize=True)
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


def apply_privacy_blur(image_data: bytes, blur_regions: List[dict]) -> bytes:
    """
    Apply Gaussian blur to specified regions of an image for privacy.

    Used to blur detected people and vehicles in camera trap images.
    Returns the original bytes unchanged if blur_regions is empty.

    Uses normalized bbox coordinates (0-1 range) so blur works correctly
    at any image size (thumbnails, full images, exports).

    Args:
        image_data: Raw image bytes (JPEG/PNG)
        blur_regions: List of detection bbox dicts, each with a
            "normalized" key containing [x_min, y_min, width, height]
            in 0-1 range relative to the original image dimensions

    Returns:
        JPEG image bytes with specified regions blurred
    """
    if not blur_regions:
        return image_data

    img = Image.open(BytesIO(image_data))
    if img.mode != 'RGB':
        img = img.convert('RGB')
    img_w, img_h = img.size

    for region in blur_regions:
        normalized = region.get('normalized')
        if not normalized or len(normalized) != 4:
            continue

        x_min_n, y_min_n, width_n, height_n = normalized
        x1 = max(0, int(x_min_n * img_w))
        y1 = max(0, int(y_min_n * img_h))
        x2 = min(img_w, int((x_min_n + width_n) * img_w))
        y2 = min(img_h, int((y_min_n + height_n) * img_h))

        if x2 <= x1 or y2 <= y1:
            continue

        cropped = img.crop((x1, y1, x2, y2))
        blurred = cropped.filter(ImageFilter.GaussianBlur(radius=25))
        img.paste(blurred, (x1, y1))

    output = BytesIO()
    img.save(output, format='JPEG', quality=95, optimize=True)
    return output.getvalue()


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
