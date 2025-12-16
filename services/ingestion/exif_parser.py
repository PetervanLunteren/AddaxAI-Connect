"""
EXIF metadata extraction using exiftool
"""
import subprocess
import json
from typing import Optional, Tuple
from datetime import datetime

from shared.logger import get_logger
from utils import convert_gps_dms_to_decimal, format_datetime_exif

logger = get_logger("ingestion")


def extract_exif(filepath: str) -> dict:
    """
    Extract EXIF metadata from image using exiftool.

    Args:
        filepath: Path to image file

    Returns:
        Dictionary with EXIF fields:
        - SerialNumber (optional)
        - Make, Model
        - DateTimeOriginal (optional)
        - GPSLatitude, GPSLongitude (optional, DMS format)
        - gps_decimal (optional, tuple of decimal degrees)

    Note:
        Returns empty dict if exiftool fails or no EXIF data present.
        Caller should handle missing fields based on camera profile.
    """
    try:
        result = subprocess.run(
            [
                'exiftool',
                '-json',
                '-SerialNumber',
                '-Make',
                '-Model',
                '-DateTimeOriginal',
                '-GPSLatitude',
                '-GPSLongitude',
                filepath
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=5
        )

        data = json.loads(result.stdout)[0]

        # Convert GPS coordinates if present
        if data.get('GPSLatitude') and data.get('GPSLongitude'):
            gps_decimal = parse_gps_coordinates(
                data['GPSLatitude'],
                data['GPSLongitude']
            )
            if gps_decimal:
                data['gps_decimal'] = gps_decimal

        logger.debug(
            "EXIF extracted",
            filepath=filepath,
            make=data.get('Make'),
            model=data.get('Model'),
            has_serial=bool(data.get('SerialNumber')),
            has_gps=bool(data.get('gps_decimal'))
        )

        return data

    except subprocess.TimeoutExpired:
        logger.warning("exiftool timeout", filepath=filepath)
        return {}

    except subprocess.CalledProcessError as e:
        logger.warning("exiftool failed", filepath=filepath, error=str(e))
        return {}

    except (json.JSONDecodeError, IndexError, KeyError) as e:
        logger.warning("Failed to parse exiftool output", filepath=filepath, error=str(e))
        return {}


def parse_gps_coordinates(lat_dms: str, lon_dms: str) -> Optional[Tuple[float, float]]:
    """
    Parse GPS coordinates from DMS format to decimal degrees.

    Args:
        lat_dms: Latitude in DMS format (e.g., "52 deg 5' 55.56\" N")
        lon_dms: Longitude in DMS format (e.g., "5 deg 7' 31.23\" E")

    Returns:
        Tuple of (latitude, longitude) in decimal degrees, or None if parsing fails
    """
    lat_decimal = convert_gps_dms_to_decimal(lat_dms)
    lon_decimal = convert_gps_dms_to_decimal(lon_dms)

    if lat_decimal is None or lon_decimal is None:
        return None

    return (lat_decimal, lon_decimal)


def get_datetime_original(exif: dict, filepath: str, allow_fallback: bool = False) -> datetime:
    """
    Get image capture datetime from EXIF or file modification time.

    Args:
        exif: EXIF metadata dictionary
        filepath: Path to image file
        allow_fallback: If True, use file mtime when EXIF datetime missing

    Returns:
        Datetime object

    Raises:
        ValueError: If DateTimeOriginal missing and fallback not allowed
    """
    datetime_str = exif.get('DateTimeOriginal')

    if datetime_str:
        try:
            return format_datetime_exif(datetime_str)
        except ValueError as e:
            logger.warning(
                "Failed to parse DateTimeOriginal",
                datetime_str=datetime_str,
                error=str(e)
            )
            if not allow_fallback:
                raise

    # DateTimeOriginal missing or failed to parse
    if allow_fallback:
        from utils import get_file_mtime
        mtime = get_file_mtime(filepath)
        logger.warning(
            "Using file mtime as fallback for DateTimeOriginal",
            filepath=filepath,
            mtime=mtime.isoformat()
        )
        return mtime
    else:
        raise ValueError(f"DateTimeOriginal missing in EXIF and fallback not allowed")
