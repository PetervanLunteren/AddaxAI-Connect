"""
Utility functions for ingestion service
"""
import os
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

from shared.config import get_settings
from shared.logger import get_logger

logger = get_logger("ingestion")
settings = get_settings()


def _upload_root() -> Path:
    """Return the configured upload root (matches main.py fallback)."""
    return Path(settings.ftps_upload_dir or "/uploads")


class ValidationError(Exception):
    """Raised when file validation fails"""
    pass


def is_valid_gps(gps: Optional[Tuple[float, float]]) -> bool:
    """
    Return True if the GPS tuple looks like a real coordinate.

    Rejects: None, exact (0, 0) (Null Island sentinel), and out-of-range values.
    Does NOT use a fuzzy near-zero threshold so real equatorial / Greenwich
    deployments are not rejected.
    """
    if gps is None:
        return False
    lat, lon = gps
    if lat is None or lon is None:
        return False
    if lat == 0.0 and lon == 0.0:
        return False
    if not (-90.0 <= lat <= 90.0):
        return False
    if not (-180.0 <= lon <= 180.0):
        return False
    return True


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


def _rejected_filename(filepath: str) -> str:
    """
    Derive a unique, collision-safe filename for the rejected/ directory.

    The name is the source path flattened (path separators become underscores)
    with the rejection wall-clock time (UTC, microsecond precision) prefixed.
    The prefix makes every rejected file unique: without it, 50 cameras all
    sending an ``img001.jpg`` with bad GPS would overwrite each other and only
    one file would survive for inspection.

    Example:
        /uploads/A.jpg
            -> 20260806T142530_123456_A.jpg
        /uploads/INSTAR/lat52.02368_lon12.98290/20260409/images/Test-Snapshot.jpeg
            -> 20260806T142530_123456_INSTAR_lat52.02368_lon12.98290_20260409_images_Test-Snapshot.jpeg
    """
    path = Path(filepath)
    try:
        rel = path.relative_to(_upload_root())
        flattened = "_".join(rel.parts)
    except ValueError:
        # filepath is not under the upload root (shouldn't happen, but be safe)
        flattened = path.name

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%f")
    return f"{stamp}_{flattened}"


def reject_file(filepath: str, reason: str, details: Optional[str] = None, exif_metadata: Optional[dict] = None) -> str:
    """
    Move file to rejected directory with error log.

    Creates:
    - <upload_root>/rejected/{reason}/{timestamp}_{flattened_filename}
    - <upload_root>/rejected/{reason}/{timestamp}_{flattened_filename}.error.json

    The rejected filename carries a timestamp prefix and the flattened source
    path, so no two rejections ever share a name (see _rejected_filename).

    After moving, empty parent directories between the source and the upload
    root are pruned so nested camera trees (e.g. INSTAR/<lat-lon>/<date>/images/)
    do not accumulate indefinitely.

    Args:
        filepath: Path to file to reject
        reason: Rejection reason (becomes subdirectory name)
        details: Additional error details
        exif_metadata: EXIF metadata extracted from file (if any)

    Returns:
        Absolute path of the moved file in the rejected/ tree. Used by the
        caller to record a Rejection row pointing at the same file.
    """
    original_filename = os.path.basename(filepath)
    rejected_filename = _rejected_filename(filepath)
    file_size = os.path.getsize(filepath)

    # Create rejection directory
    rejected_dir = _upload_root() / "rejected" / reason
    rejected_dir.mkdir(parents=True, exist_ok=True)

    # Move file
    dest_path = rejected_dir / rejected_filename
    shutil.move(filepath, dest_path)

    # Create error JSON with metadata
    error_data = {
        "filename": original_filename,
        "source_path": filepath,
        "rejected_at": datetime.now(timezone.utc).isoformat() + "Z",
        "reason": reason,
        "details": details or "",
        "file_size_bytes": file_size,
        "exif_metadata": exif_metadata or {},
    }

    error_json_path = rejected_dir / f"{rejected_filename}.error.json"
    with open(error_json_path, 'w') as f:
        json.dump(error_data, f, indent=2)

    logger.warning(
        "File rejected",
        file_name=original_filename,
        reason=reason,
        details=details,
        dest_path=str(dest_path)
    )

    # Clean up any now-empty parent dirs left behind by the move
    prune_empty_parents(filepath)

    return str(dest_path)


def delete_file(filepath: str) -> None:
    """
    Delete file after successful processing.

    After deleting, empty parent directories between the file and the upload
    root are pruned so nested camera trees do not accumulate indefinitely.

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
        return

    prune_empty_parents(filepath)


def prune_empty_parents(filepath: str) -> None:
    """
    Walk up from ``filepath`` deleting empty parent directories.

    Stops at the first non-empty directory or when reaching the upload root
    (whichever comes first). Best-effort: swallows OSError so a race with
    a concurrent FTPS upload cannot crash the ingestion service.

    The upload root itself and the ``rejected/`` tree are never pruned.
    """
    upload_root = _upload_root().resolve()
    rejected_root = (upload_root / "rejected").resolve()

    try:
        current = Path(filepath).resolve().parent
    except OSError:
        return

    while True:
        # Never prune the upload root, the rejected tree, or anything outside them
        if current == upload_root:
            return
        if current == rejected_root or rejected_root in current.parents:
            return
        if upload_root not in current.parents:
            return

        try:
            current.rmdir()  # Fails with OSError if not empty
        except OSError:
            return

        current = current.parent


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
