"""
Daily report parser

Parses health/status reports from camera traps.
Supports multiple formats (Willfine, SY).
"""
import os
from typing import Optional, Tuple
from datetime import datetime

from shared.logger import get_logger

logger = get_logger("ingestion")


def parse_daily_report(filepath: str) -> dict:
    """
    Parse daily report TXT file.

    Handles multiple formats:
    - Willfine: Key:Value format with IMEI field
    - SY: "dailyreport" in filename, camera ID from filename

    Args:
        filepath: Path to daily report file

    Returns:
        Dictionary with parsed data:
        - camera_id: Unique camera identifier
        - signal_quality: 0-31 (CSQ)
        - temperature: Celsius
        - battery_percentage: 0-100
        - sd_utilization_percentage: 0-100
        - gps_location: (lat, lon) tuple or None
        - total_images: Count
        - sent_images: Count
        - report_datetime: When report was generated

    Raises:
        ValueError: If camera ID cannot be determined
    """
    filename = os.path.basename(filepath)

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Parse key:value pairs
    raw_data = {}
    for line in content.strip().splitlines():
        line = line.strip()
        if ':' in line:
            key, value = line.split(':', 1)
            raw_data[key.strip()] = value.strip()

    logger.debug("Parsed daily report raw data", filename=filename, keys=list(raw_data.keys()))

    # Determine camera ID
    camera_id = None

    # Try Willfine format (IMEI in file content)
    if 'IMEI' in raw_data:
        camera_id = raw_data['IMEI']

    # Try SY format (camera ID from filename)
    elif 'dailyreport' in filename.lower():
        # Filename pattern: something-CAMERAID-dailyreport.txt
        # Extract second part after split by '-'
        parts = filename.split('-', 2)
        if len(parts) >= 2:
            camera_id = parts[1]

    if not camera_id:
        raise ValueError(
            f"Cannot determine camera ID from daily report. "
            f"Filename: {filename}, Keys: {list(raw_data.keys())}"
        )

    # Parse fields
    parsed = {
        'camera_id': camera_id,
        'signal_quality': parse_signal_quality(raw_data.get('CSQ')),
        'temperature': parse_temperature(raw_data.get('Temp')),
        'battery_percentage': parse_battery(raw_data.get('Battery')),
        'sd_utilization_percentage': parse_sd_card(raw_data.get('SD')),
        'gps_location': parse_gps_decimal(raw_data.get('GPS')),
        'total_images': int(raw_data.get('Total', 0)),
        'sent_images': int(raw_data.get('Send', 0)),
        'report_datetime': parse_report_datetime(raw_data.get('Date')),
    }

    logger.info(
        "Daily report parsed",
        camera_id=camera_id,
        battery=parsed['battery_percentage'],
        temperature=parsed['temperature'],
        signal_quality=parsed['signal_quality']
    )

    return parsed


def parse_signal_quality(csq_str: Optional[str]) -> Optional[int]:
    """
    Parse CSQ (signal quality) field.

    Args:
        csq_str: CSQ value as string (e.g., "31")

    Returns:
        Integer 0-31, or None if not parseable
    """
    if not csq_str:
        return None

    try:
        csq = int(csq_str)
        return max(0, min(31, csq))  # Clamp to 0-31
    except ValueError:
        logger.warning("Failed to parse CSQ", csq_str=csq_str)
        return None


def parse_temperature(temp_str: Optional[str]) -> Optional[int]:
    """
    Parse temperature field.

    Args:
        temp_str: Temperature with °C suffix (e.g., "24℃ " or "24℃")

    Returns:
        Temperature in Celsius, or None if not parseable
    """
    if not temp_str:
        return None

    try:
        # Strip trailing space and degree symbol
        temp_clean = temp_str.rstrip('℃ ')
        return int(temp_clean)
    except ValueError:
        logger.warning("Failed to parse temperature", temp_str=temp_str)
        return None


def parse_battery(battery_str: Optional[str]) -> Optional[int]:
    """
    Parse battery percentage field.

    Args:
        battery_str: Battery with % suffix (e.g., "60%")

    Returns:
        Battery percentage 0-100, or None if not parseable
    """
    if not battery_str:
        return None

    try:
        # Strip % suffix
        battery_clean = battery_str.rstrip('%')
        battery = int(battery_clean)
        return max(0, min(100, battery))  # Clamp to 0-100
    except ValueError:
        logger.warning("Failed to parse battery", battery_str=battery_str)
        return None


def parse_sd_card(sd_str: Optional[str]) -> Optional[float]:
    """
    Parse SD card utilization field.

    Args:
        sd_str: SD usage in format "used/total" (e.g., "59405M/59628M")

    Returns:
        Utilization percentage (0-100), or None if not parseable
    """
    if not sd_str:
        return None

    try:
        # Format: "59405M/59628M"
        used_str, total_str = sd_str.split('/')
        used = int(used_str.rstrip('M'))
        total = int(total_str.rstrip('M'))

        if total == 0:
            return 0.0

        utilization = (used / total) * 100
        return round(utilization, 2)

    except (ValueError, IndexError) as e:
        logger.warning("Failed to parse SD card", sd_str=sd_str, error=str(e))
        return None


def parse_gps_decimal(gps_str: Optional[str]) -> Optional[Tuple[float, float]]:
    """
    Parse GPS coordinates in decimal format.

    Args:
        gps_str: GPS in format "lat,lon" (e.g., "52.098737,5.125504")

    Returns:
        Tuple of (latitude, longitude), or None if not parseable
    """
    if not gps_str:
        return None

    try:
        lat_str, lon_str = gps_str.split(',')
        lat = float(lat_str.strip())
        lon = float(lon_str.strip())
        return (lat, lon)

    except (ValueError, IndexError) as e:
        logger.warning("Failed to parse GPS", gps_str=gps_str, error=str(e))
        return None


def parse_report_datetime(date_str: Optional[str]) -> Optional[datetime]:
    """
    Parse report generation datetime.

    Args:
        date_str: Date in format "DD/MM/YYYY HH:MM:SS" (e.g., "05/12/2025 15:46:47")

    Returns:
        Datetime object, or None if not parseable
    """
    if not date_str:
        return None

    try:
        return datetime.strptime(date_str, '%d/%m/%Y %H:%M:%S')
    except ValueError as e:
        logger.warning("Failed to parse report datetime", date_str=date_str, error=str(e))
        return None
