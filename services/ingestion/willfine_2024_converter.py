"""
Willfine-2024 to Willfine-2025 Format Converter

This module converts legacy Willfine-2024 camera files to Willfine-2025 format
for testing purposes. It allows testing with existing Willfine-2024 data while
maintaining a single camera profile in production.

TEMPORARY MODULE: This is debug/testing code that can be removed once testing
is complete. To remove:
  1. Delete this file (willfine_2024_converter.py)
  2. Remove the import and conversion calls from main.py
  3. Done!

Conversions performed:
  Images:
    - EXIF Make: "SY" → "Willfine"
    - EXIF Model: "4.0PCG" → "4.0T CG"
    - EXIF SerialNumber: Add IMEI from mapping

  Daily Reports:
    - Remove CamID field
    - Temperature: "26 Celsius Degree" → "26℃"
    - GPS: DMS format → Decimal format
    - Date: Double space → Single space
    - Keys: "Total Pics" → "Total", "Send times" → "Send"
"""
import os
import re
import subprocess
import json
from typing import Optional, Tuple
from shared.logger import get_logger

logger = get_logger("ingestion")


# Willfine-2024 Camera Serial Number Mapping
# Maps friendly names to IMEI serial numbers
WILLFINE_2024_SERIAL_MAPPING = {
    '0000000WUH01': '860946063666658',
    '0000000WUH02': '860946063362308',
    '0000000WUH03': '860946063655883',
    '0000000WUH04': '860946063352523',
    '0000000WUH05': '860946063653268',
    '0000000WUH06': '860946063340346',
    '0000000WUH07': '860946063351095',
    '0000000WUH08': '860946063337391',
    '0000000WUH09': '860946063660255',
    '0000000WUH10': '860946063339116',
    '0000000WUH11': '860946062360345',
}


def is_willfine_2024_image(filepath: str) -> bool:
    """
    Check if image file is from Willfine-2024 camera.

    Args:
        filepath: Path to image file

    Returns:
        True if Willfine-2024, False otherwise
    """
    try:
        result = subprocess.run(
            ['exiftool', '-json', '-Make', '-Model', filepath],
            capture_output=True,
            text=True,
            check=True,
            timeout=5
        )
        data = json.loads(result.stdout)[0]
        make = data.get('Make', '')
        model = data.get('Model', '')

        # Match both "4.0PCG" and variants like "4.0PCG-R"
        is_2024 = make == 'SY' and model.startswith('4.0PCG')

        if is_2024:
            logger.debug("Detected Willfine-2024 image", filepath=filepath)

        return is_2024

    except Exception as e:
        logger.warning("Failed to detect camera type", filepath=filepath, error=str(e))
        return False


def convert_willfine_2024_image(filepath: str) -> bool:
    """
    Convert Willfine-2024 image to Willfine-2025 format in-place.

    Modifies EXIF fields:
      - Make: SY → Willfine
      - Model: 4.0PCG → 4.0T CG
      - SerialNumber: (add from mapping)

    Args:
        filepath: Path to image file

    Returns:
        True if conversion successful, False otherwise

    Raises:
        ValueError: If camera ID cannot be extracted or not in mapping
    """
    filename = os.path.basename(filepath)

    # Extract camera ID from filename (e.g., WUH09 from 0000000WUH09-SYPR1113.JPG)
    match = re.search(r'([A-Z]{3}\d{2})', filename)
    if not match:
        raise ValueError(
            f"Cannot extract camera ID from Willfine-2024 filename: {filename}"
        )

    friendly_name = match.group(1)  # e.g., 'WUH09'
    full_key = f'0000000{friendly_name}'  # e.g., '0000000WUH09'

    # Look up IMEI serial number
    serial_number = WILLFINE_2024_SERIAL_MAPPING.get(full_key)
    if not serial_number:
        raise ValueError(
            f"Unknown Willfine-2024 camera: {friendly_name}. "
            f"Camera {full_key} not found in WILLFINE_2024_SERIAL_MAPPING. "
            f"Cannot convert to Willfine-2025 format."
        )

    logger.info(
        "Converting Willfine-2024 image to Willfine-2025",
        file_name=filename,
        camera_id=friendly_name,
        serial_number=serial_number
    )

    try:
        # Work in a temporary directory to avoid triggering watchdog with temp files
        import tempfile
        import shutil

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_file = os.path.join(temp_dir, filename)

            # Copy file to temp directory
            shutil.copy2(filepath, temp_file)

            # Modify EXIF in temp directory (temp files won't trigger watchdog)
            subprocess.run(
                [
                    'exiftool',
                    '-overwrite_original',  # Don't create backup file
                    f'-Make=Willfine',
                    f'-Model=4.0T CG',
                    f'-SerialNumber={serial_number}',
                    temp_file
                ],
                capture_output=True,
                text=True,
                check=True,
                timeout=10
            )

            # Copy modified file back, overwriting original
            shutil.copy2(temp_file, filepath)

        logger.info(
            "Successfully converted Willfine-2024 image",
            file_name=filename,
            camera_id=friendly_name
        )

        return True

    except subprocess.CalledProcessError as e:
        logger.error(
            "Failed to convert Willfine-2024 image",
            file_name=filename,
            error=str(e),
            stderr=e.stderr,
            exc_info=True
        )
        return False

    except subprocess.TimeoutExpired:
        logger.error(
            "exiftool timeout during conversion",
            file_name=filename
        )
        return False


def is_willfine_2024_daily_report(filepath: str) -> bool:
    """
    Check if daily report file is from Willfine-2024 camera.

    Willfine-2024 reports have both IMEI and CamID fields.
    Willfine-2025 reports have only IMEI field.

    Args:
        filepath: Path to daily report file

    Returns:
        True if Willfine-2024, False otherwise
    """
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Check for both IMEI and CamID fields
        has_imei = 'IMEI:' in content
        has_camid = 'CamID:' in content

        is_2024 = has_imei and has_camid

        if is_2024:
            logger.debug("Detected Willfine-2024 daily report", filepath=filepath)

        return is_2024

    except Exception as e:
        logger.warning(
            "Failed to detect daily report type",
            filepath=filepath,
            error=str(e)
        )
        return False


def convert_willfine_2024_daily_report(filepath: str) -> bool:
    """
    Convert Willfine-2024 daily report to Willfine-2025 format in-place.

    Conversions:
      - Remove CamID field
      - Temperature: "26 Celsius Degree" → "26℃"
      - GPS: DMS → Decimal
      - Date: Double space → Single space
      - Keys: "Total Pics" → "Total", "Send times" → "Send"

    Args:
        filepath: Path to daily report file

    Returns:
        True if conversion successful, False otherwise
    """
    filename = os.path.basename(filepath)

    logger.info("Converting Willfine-2024 daily report to Willfine-2025", file_name=filename)

    try:
        # Read and parse original file
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Parse key:value pairs
        raw_data = {}
        for line in content.strip().splitlines():
            line = line.strip()
            if ':' in line:
                key, value = line.split(':', 1)
                raw_data[key.strip()] = value.strip()

        # Convert to Willfine-2025 format
        converted_lines = []

        # IMEI (keep as-is)
        if 'IMEI' in raw_data:
            converted_lines.append(f"IMEI: {raw_data['IMEI']}")

        # CSQ (keep as-is)
        if 'CSQ' in raw_data:
            converted_lines.append(f"CSQ: {raw_data['CSQ']}")

        # Temperature: "26 Celsius Degree" → "26℃"
        if 'Temp' in raw_data:
            temp_celsius = raw_data['Temp'].split()[0]  # Extract just the number
            converted_lines.append(f"Temp: {temp_celsius}℃")

        # Battery (keep as-is)
        if 'Battery' in raw_data:
            converted_lines.append(f"Battery: {raw_data['Battery']}")

        # SD (keep as-is)
        if 'SD' in raw_data:
            converted_lines.append(f"SD: {raw_data['SD']}")

        # GPS: DMS → Decimal
        if 'GPS' in raw_data:
            gps_decimal = convert_gps_dms_to_decimal(raw_data['GPS'])
            if gps_decimal:
                lat, lon = gps_decimal
                converted_lines.append(f"GPS: {lat},{lon}")
            else:
                # Keep original if conversion fails
                converted_lines.append(f"GPS: {raw_data['GPS']}")

        # Date: Double space → Single space
        if 'Date' in raw_data:
            date_normalized = ' '.join(raw_data['Date'].split())
            converted_lines.append(f"Date: {date_normalized}")

        # Total Pics → Total
        if 'Total Pics' in raw_data:
            converted_lines.append(f"Total: {raw_data['Total Pics']}")

        # Send times → Send
        if 'Send times' in raw_data:
            converted_lines.append(f"Send: {raw_data['Send times']}")

        # Write converted content back to file
        converted_content = '\n'.join(converted_lines) + '\n'

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(converted_content)

        logger.info(
            "Successfully converted Willfine-2024 daily report",
            file_name=filename
        )

        return True

    except Exception as e:
        logger.error(
            "Failed to convert Willfine-2024 daily report",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        return False


def convert_gps_dms_to_decimal(gps_str: str) -> Optional[Tuple[float, float]]:
    """
    Convert GPS from DMS format (Willfine-2024) to decimal format (Willfine-2025).

    Args:
        gps_str: GPS in format "N52*05'55\" E005*07'31\""

    Returns:
        Tuple of (latitude, longitude) in decimal degrees, or None if parsing fails
    """
    if not gps_str:
        return None

    try:
        # Pattern: N52*05'55" E005*07'31"
        pattern = r"([NS])(\d+)\*(\d+)'(\d+)\"?\s*([EW])(\d+)\*(\d+)'(\d+)\"?"
        match = re.match(pattern, gps_str)

        if not match:
            logger.warning("Failed to parse GPS DMS", gps_str=gps_str)
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
        logger.warning("Failed to convert GPS DMS to decimal", gps_str=gps_str, error=str(e))
        return None
