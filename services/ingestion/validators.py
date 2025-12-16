"""
File validation functions
"""
import os
from shared.logger import get_logger
from utils import ValidationError

logger = get_logger("ingestion")


def validate_mime_type(filepath: str) -> None:
    """
    Validate file is actually a JPEG by checking magic bytes.

    JPEG files start with: FF D8 FF

    Args:
        filepath: Path to file

    Raises:
        ValidationError: If file is not a valid JPEG
    """
    with open(filepath, 'rb') as f:
        magic_bytes = f.read(3)

    if magic_bytes != b'\xff\xd8\xff':
        raise ValidationError(
            f"Invalid JPEG magic bytes: {magic_bytes.hex()}. "
            f"Expected: ffd8ff"
        )


def validate_file_size(filepath: str, max_mb: int) -> None:
    """
    Validate file size is within limits.

    Args:
        filepath: Path to file
        max_mb: Maximum file size in megabytes

    Raises:
        ValidationError: If file exceeds size limit
    """
    file_size_bytes = os.path.getsize(filepath)
    file_size_mb = file_size_bytes / (1024 * 1024)

    if file_size_mb > max_mb:
        raise ValidationError(
            f"File too large: {file_size_mb:.2f}MB > {max_mb}MB limit"
        )


def validate_image(filepath: str) -> None:
    """
    Run all validations for image files.

    Args:
        filepath: Path to image file

    Raises:
        ValidationError: If any validation fails
    """
    validate_mime_type(filepath)
    validate_file_size(filepath, max_mb=10)

    logger.debug("Image file validation passed", filepath=filepath)


def validate_daily_report(filepath: str) -> None:
    """
    Run all validations for daily report files.

    Args:
        filepath: Path to daily report file

    Raises:
        ValidationError: If any validation fails
    """
    # Only check file size for TXT files (no MIME check)
    validate_file_size(filepath, max_mb=1)

    logger.debug("Daily report validation passed", filepath=filepath)
