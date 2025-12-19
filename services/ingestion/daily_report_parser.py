"""
Daily report parser

Parses health/status reports from camera traps.
Supports multiple formats (Willfine-2025, Willfine-2024).
"""
import os
import re
from typing import Optional, Tuple
from datetime import datetime

from shared.logger import get_logger

logger = get_logger("ingestion")


def parse_daily_report(filepath: str) -> dict:
    """
    Parse daily report TXT file.

    Routes to appropriate parser based on camera type detection.

    Args:
        filepath: Path to daily report file

    Returns:
        Dictionary with parsed data (see specific parser functions)

    Raises:
        ValueError: If camera type cannot be determined
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

    logger.debug("Parsed daily report raw data", file_name=filename, keys=list(raw_data.keys()))

    # Determine camera type and route to appropriate parser
    # Willfine-2024: Has both IMEI and CamID fields
    if 'IMEI' in raw_data and 'CamID' in raw_data:
        return parse_willfine_2024_report(filepath, raw_data)

    # Willfine-2025: Has IMEI field but not CamID
    elif 'IMEI' in raw_data:
        return parse_willfine_2025_report(filepath, raw_data)

    else:
        raise ValueError(
            f"Cannot determine camera type from daily report. "
            f"Filename: {filename}, Keys: {list(raw_data.keys())}"
        )


def parse_willfine_2025_report(filepath: str, raw_data: dict) -> dict:
    """
    Parse Willfine-2025 daily report.

    Format:
    - IMEI in file content (no CamID field)
    - Temperature: "24℃" format
    - GPS: Decimal format "52.098737,5.125504"
    - Date: "DD/MM/YYYY HH:MM:SS"
    - Keys: Total, Send (no spaces)

    Args:
        filepath: Path to daily report file
        raw_data: Parsed key:value pairs

    Returns:
        Dictionary with parsed data
    """
    filename = os.path.basename(filepath)
    camera_id = raw_data['IMEI']

    parsed = {
        'camera_id': camera_id,
        'signal_quality': parse_signal_quality(raw_data.get('CSQ')),
        'temperature': parse_temperature_2025(raw_data.get('Temp')),
        'battery_percentage': parse_battery(raw_data.get('Battery')),
        'sd_utilization_percentage': parse_sd_card(raw_data.get('SD')),
        'gps_location': parse_gps_decimal(raw_data.get('GPS')),
        'total_images': int(raw_data.get('Total', 0)),
        'sent_images': int(raw_data.get('Send', 0)),
        'report_datetime': parse_report_datetime_2025(raw_data.get('Date')),
    }

    logger.info(
        "Willfine-2025 daily report parsed",
        camera_id=camera_id,
        battery=parsed['battery_percentage'],
        temperature=parsed['temperature'],
        signal_quality=parsed['signal_quality']
    )

    return parsed


def parse_willfine_2024_report(filepath: str, raw_data: dict) -> dict:
    """
    Parse Willfine-2024 daily report.

    Format:
    - IMEI and CamID in file content
    - Temperature: "26 Celsius Degree" format
    - GPS: DMS format with asterisks "N52*05'55\" E005*07'31\""
    - Date: "DD/MM/YYYY  HH:MM:SS" (double space)
    - Keys: "Total Pics", "Send times" (with spaces)

    Args:
        filepath: Path to daily report file
        raw_data: Parsed key:value pairs

    Returns:
        Dictionary with parsed data
    """
    filename = os.path.basename(filepath)
    camera_id = raw_data['IMEI']

    parsed = {
        'camera_id': camera_id,
        'signal_quality': parse_signal_quality(raw_data.get('CSQ')),
        'temperature': parse_temperature_2024(raw_data.get('Temp')),
        'battery_percentage': parse_battery(raw_data.get('Battery')),
        'sd_utilization_percentage': parse_sd_card(raw_data.get('SD')),
        'gps_location': parse_gps_dms(raw_data.get('GPS')),
        'total_images': int(raw_data.get('Total Pics', 0)),
        'sent_images': int(raw_data.get('Send times', 0)),
        'report_datetime': parse_report_datetime_2024(raw_data.get('Date')),
    }

    logger.info(
        "Willfine-2024 daily report parsed",
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


def parse_temperature_2025(temp_str: Optional[str]) -> Optional[int]:
    """
    Parse temperature field for Willfine-2025 cameras.

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
        logger.warning("Failed to parse temperature (Willfine-2025)", temp_str=temp_str)
        return None


def parse_temperature_2024(temp_str: Optional[str]) -> Optional[int]:
    """
    Parse temperature field for Willfine-2024 cameras.

    Args:
        temp_str: Temperature in format "26 Celsius Degree"

    Returns:
        Temperature in Celsius, or None if not parseable
    """
    if not temp_str:
        return None

    try:
        # Extract first number before "Celsius"
        temp_clean = temp_str.split()[0]
        return int(temp_clean)
    except (ValueError, IndexError):
        logger.warning("Failed to parse temperature (Willfine-2024)", temp_str=temp_str)
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


def parse_report_datetime_2025(date_str: Optional[str]) -> Optional[datetime]:
    """
    Parse report generation datetime for Willfine-2025 cameras.

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
        logger.warning("Failed to parse report datetime (Willfine-2025)", date_str=date_str, error=str(e))
        return None


def parse_report_datetime_2024(date_str: Optional[str]) -> Optional[datetime]:
    """
    Parse report generation datetime for Willfine-2024 cameras.

    Args:
        date_str: Date in format "DD/MM/YYYY  HH:MM:SS" (double space before time)
                  (e.g., "19/12/2025  16:21:42")

    Returns:
        Datetime object, or None if not parseable
    """
    if not date_str:
        return None

    try:
        # Normalize double spaces to single space
        date_normalized = ' '.join(date_str.split())
        return datetime.strptime(date_normalized, '%d/%m/%Y %H:%M:%S')
    except ValueError as e:
        logger.warning("Failed to parse report datetime (Willfine-2024)", date_str=date_str, error=str(e))
        return None


def parse_gps_dms(gps_str: Optional[str]) -> Optional[Tuple[float, float]]:
    """
    Parse GPS coordinates in DMS format with asterisks (Willfine-2024).

    Args:
        gps_str: GPS in format "N52*05'55\" E005*07'31\""
                 (degrees with asterisks instead of degree symbol)

    Returns:
        Tuple of (latitude, longitude) in decimal degrees, or None if not parseable
    """
    if not gps_str:
        return None

    try:
        # Pattern: N52*05'55" E005*07'31"
        # Match: (N/S)(deg)*(min)'(sec)" (E/W)(deg)*(min)'(sec)"
        pattern = r"([NS])(\d+)\*(\d+)'(\d+)\"?\s*([EW])(\d+)\*(\d+)'(\d+)\"?"
        match = re.match(pattern, gps_str)

        if not match:
            logger.warning("Failed to parse GPS DMS (Willfine-2024)", gps_str=gps_str)
            return None

        lat_dir, lat_deg, lat_min, lat_sec, lon_dir, lon_deg, lon_min, lon_sec = match.groups()

        # Convert to decimal
        lat_decimal = int(lat_deg) + int(lat_min) / 60 + int(lat_sec) / 3600
        lon_decimal = int(lon_deg) + int(lon_min) / 60 + int(lon_sec) / 3600

        # Apply direction (S and W are negative)
        if lat_dir == 'S':
            lat_decimal = -lat_decimal
        if lon_dir == 'W':
            lon_decimal = -lon_decimal

        return (lat_decimal, lon_decimal)

    except (ValueError, AttributeError) as e:
        logger.warning("Failed to parse GPS DMS (Willfine-2024)", gps_str=gps_str, error=str(e))
        return None
