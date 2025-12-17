"""
Image cropping logic

Crops detected bounding boxes from images with padding.
"""
from PIL import Image
from pathlib import Path
from typing import Optional

from shared.logger import get_logger
from detector import Detection

logger = get_logger("detection.cropper")


def crop_detection(
    image_path: str,
    detection: Detection,
    output_path: str,
    padding_percent: float = 0.1
) -> None:
    """
    Crop detection bbox from image with padding.

    Args:
        image_path: Path to source image
        detection: Detection object with bbox coordinates
        output_path: Path to save cropped image
        padding_percent: Padding around bbox as percentage (default 10%)

    Raises:
        Exception: If cropping fails
    """
    try:
        # Open image
        image = Image.open(image_path)
        img_width, img_height = image.size

        # Get bbox in pixels
        x_min, y_min, width, height = detection.bbox_pixels

        # Calculate padding
        padding_x = int(width * padding_percent)
        padding_y = int(height * padding_percent)

        # Apply padding and ensure within image bounds
        x_min = max(0, x_min - padding_x)
        y_min = max(0, y_min - padding_y)
        x_max = min(img_width, x_min + width + 2 * padding_x)
        y_max = min(img_height, y_min + height + 2 * padding_y)

        # Crop image (PIL uses (left, upper, right, lower) format)
        crop = image.crop((x_min, y_min, x_max, y_max))

        # Save crop
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)
        crop.save(output_path, quality=95)

        logger.debug(
            "Cropped detection",
            bbox=[x_min, y_min, x_max - x_min, y_max - y_min],
            output=output_path
        )

    except Exception as e:
        logger.error(
            "Crop failed",
            image_path=image_path,
            output_path=output_path,
            error=str(e),
            exc_info=True
        )
        raise


def generate_crop_filename(image_uuid: str, detection_idx: int) -> str:
    """
    Generate standardized crop filename.

    Args:
        image_uuid: UUID of source image
        detection_idx: Index of detection (0-based)

    Returns:
        Filename string (e.g., "abc-123_0.jpg")
    """
    return f"{image_uuid}_{detection_idx}.jpg"
