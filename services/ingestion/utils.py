"""
Utility functions for ingestion service
"""
import os
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from shared.logger import get_logger

logger = get_logger("ingestion")


class ValidationError(Exception):
    """Raised when file validation fails"""
    pass


def get_file_mtime(filepath: str) -> datetime:
    """
    Get file modification time.

    Args:
        filepath: Path to file

    Returns:
        Modification timestamp as datetime
    """
    mtime = os.path.getmtime(filepath)
    return datetime.fromtimestamp(mtime)


def reject_file(filepath: str, reason: str, details: Optional[str] = None, exif_metadata: Optional[dict] = None) -> None:
    """
    Move file to rejected directory with error log.

    Creates:
    - /uploads/rejected/{reason}/{filename}
    - /uploads/rejected/{reason}/{filename}.error.json

    Args:
        filepath: Path to file to reject
        reason: Rejection reason (becomes subdirectory name)
        details: Additional error details
        exif_metadata: EXIF metadata extracted from file (if any)
    """
    filename = os.path.basename(filepath)
    file_size = os.path.getsize(filepath)

    # Create rejection directory
    rejected_dir = Path("/uploads/rejected") / reason
    rejected_dir.mkdir(parents=True, exist_ok=True)

    # Move file
    dest_path = rejected_dir / filename
    shutil.move(filepath, dest_path)

    # Create error JSON with metadata
    error_data = {
        "filename": filename,
        "rejected_at": datetime.utcnow().isoformat() + "Z",
        "reason": reason,
        "details": details or "",
        "file_size_bytes": file_size,
        "exif_metadata": exif_metadata or {},
    }

    error_json_path = rejected_dir / f"{filename}.error.json"
    with open(error_json_path, 'w') as f:
        json.dump(error_data, f, indent=2)

    logger.warning(
        "File rejected",
        file_name=filename,
        reason=reason,
        details=details,
        dest_path=str(dest_path)
    )


def delete_file(filepath: str) -> None:
    """
    Delete file after successful processing.

    Args:
        filepath: Path to file to delete
    """
    filename = os.path.basename(filepath)

    try:
        os.remove(filepath)
        logger.info("File deleted after processing", file_name=filename)
    except Exception as e:
        logger.error(
            "Failed to delete file",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        # Don't raise - file was already processed successfully


def convert_gps_dms_to_decimal(dms_str: str) -> Optional[float]:
    """
    Convert GPS coordinates from DMS to decimal degrees.

    Args:
        dms_str: DMS string like "52 deg 5' 55.56\" N"

    Returns:
        Decimal degrees, or None if parsing fails

    Examples:
        >>> convert_gps_dms_to_decimal("52 deg 5' 55.56\" N")
        52.098766667
        >>> convert_gps_dms_to_decimal("5 deg 7' 31.23\" W")
        -5.125341667
    """
    import re

    if not dms_str:
        return None

    # Pattern: "52 deg 5' 55.56" N"
    match = re.match(r"(\d+)\s+deg\s+(\d+)'\s+([\d.]+)\"\s+([NSEW])", dms_str)
    if not match:
        logger.warning("Failed to parse GPS DMS", dms_str=dms_str)
        return None

    degrees = float(match.group(1))
    minutes = float(match.group(2))
    seconds = float(match.group(3))
    direction = match.group(4)

    decimal = degrees + (minutes / 60) + (seconds / 3600)

    # South and West are negative
    if direction in ['S', 'W']:
        decimal = -decimal

    return decimal


def format_datetime_exif(exif_datetime: str) -> datetime:
    """
    Parse EXIF datetime string to Python datetime.

    Args:
        exif_datetime: EXIF format like "2025:12:05 15:46:07"

    Returns:
        Parsed datetime object

    Raises:
        ValueError: If parsing fails
    """
    return datetime.strptime(exif_datetime, "%Y:%m:%d %H:%M:%S")
