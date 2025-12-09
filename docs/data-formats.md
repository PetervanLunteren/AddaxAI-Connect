# Data Formats Documentation

**Document Version:** 1.0
**Date:** December 9, 2025
**Purpose:** Document all data formats used in AddaxAI Connect for camera trap images and daily reports

---

## Table of Contents

1. [Overview](#overview)
2. [Image EXIF Data](#image-exif-data)
3. [Daily Report Format](#daily-report-format)
4. [Filename Conventions](#filename-conventions)
5. [Parsing Examples](#parsing-examples)
6. [Error Handling](#error-handling)

---

## Overview

AddaxAI Connect receives two types of files from 4G camera traps via FTPS:

1. **Images** (JPEG files with EXIF metadata)
2. **Daily Reports** (TXT files with key:value health data)

Both file types contain a camera identifier (Serial Number/IMEI) used to link data to the correct camera record.

---

## Image EXIF Data

### Format

Images are standard JPEG files with embedded EXIF metadata. The critical fields for AddaxAI Connect are:

### Example EXIF Metadata

**Source file:** `test-ftps-files/E1000159.JPG`

```
ExifTool Version Number         : 12.63
File Name                       : E1000159.JPG
File Size                       : 122 kB
File Type                       : JPEG
MIME Type                       : image/jpeg

Make                            : Willfine
Camera Model Name               : 4.0T CG Regular lens
Software                        : R1.0

Serial Number                   : 861943070068027    ← PRIMARY IDENTIFIER

Date/Time Original              : 2025:12:05 15:46:07
Create Date                     : 2025:12:05 15:46:07

GPS Version ID                  : 2.0.0.0
GPS Latitude Ref                : North
GPS Longitude Ref               : East
GPS Latitude                    : 52 deg 5' 55.56" N
GPS Longitude                   : 5 deg 7' 31.23" E
GPS Position                    : 52 deg 5' 55.56" N, 5 deg 7' 31.23" E

Exposure Time                   : 1/33
F Number                        : 2.0
ISO                             : 285
Focal Length                    : 6.8 mm

Image Width                     : 1280
Image Height                    : 960
```

### Critical Fields

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| **Serial Number** | String | **Primary camera identifier** (equals IMEI) | `861943070068027` |
| **Make** | String | Camera manufacturer | `Willfine` |
| **Camera Model Name** | String | Camera model | `4.0T CG Regular lens` |
| **Date/Time Original** | DateTime | Image capture timestamp | `2025:12:05 15:46:07` |
| **GPS Latitude** | DMS String | Latitude in degrees-minutes-seconds | `52 deg 5' 55.56" N` |
| **GPS Longitude** | DMS String | Longitude in degrees-minutes-seconds | `5 deg 7' 31.23" E` |
| **GPS Position** | DMS String | Combined lat/lon | `52 deg 5' 55.56" N, 5 deg 7' 31.23" E` |

### Optional Fields

| Field | Type | Notes |
|-------|------|-------|
| Software | String | Firmware version (e.g., `R1.0`) |
| Exposure Time | String | Camera settings |
| ISO | Integer | Camera settings |

### Fields NOT Present in EXIF

⚠️ **Important:** The following health metrics are **NOT** in image EXIF. They are only available in daily reports:

- Battery percentage
- SD card utilization
- Temperature
- Signal quality

### GPS Coordinate Conversion

GPS coordinates in EXIF are in **Degrees-Minutes-Seconds (DMS)** format. They must be converted to **decimal degrees** for storage in PostGIS.

**Conversion formula:**
```
Decimal Degrees = Degrees + (Minutes / 60) + (Seconds / 3600)
```

**Example:**
```
EXIF: "52 deg 5' 55.56" N"
Calculation: 52 + (5/60) + (55.56/3600) = 52.098766667°

EXIF: "5 deg 7' 31.23" E"
Calculation: 5 + (7/60) + (31.23/3600) = 5.125341667°

Result: (52.098767, 5.125342)
```

### Parsing EXIF in Python

**Method 1: Using exiftool (recommended)**
```python
import subprocess
import json

def extract_exif(filepath: str) -> dict:
    """Extract EXIF using exiftool"""
    result = subprocess.run(
        ['exiftool', '-json', filepath],
        capture_output=True,
        text=True
    )
    data = json.loads(result.stdout)[0]

    return {
        'serial_number': data.get('SerialNumber'),
        'make': data.get('Make'),
        'model': data.get('CameraModelName'),
        'datetime_original': data.get('DateTimeOriginal'),
        'gps_latitude': parse_gps_dms(data.get('GPSLatitude')),
        'gps_longitude': parse_gps_dms(data.get('GPSLongitude')),
        'software': data.get('Software')
    }

def parse_gps_dms(dms_str: str) -> float:
    """Convert DMS string to decimal degrees"""
    if not dms_str:
        return None

    # Example: "52 deg 5' 55.56\" N"
    import re
    match = re.match(r"(\d+) deg (\d+)' ([\d.]+)\" ([NSEW])", dms_str)
    if not match:
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
```

**Method 2: Using Pillow + piexif**
```python
from PIL import Image
import piexif

def extract_exif_pillow(filepath: str) -> dict:
    """Extract EXIF using Pillow"""
    img = Image.open(filepath)
    exif_data = piexif.load(img.info['exif'])

    # Serial number is in MakerNote (may vary by manufacturer)
    # GPS data in GPSInfo
    gps = exif_data.get('GPS', {})

    return {
        'serial_number': None,  # Hard to extract without exiftool
        'gps_latitude': convert_gps_to_decimal(gps.get(piexif.GPSIFD.GPSLatitude)),
        'gps_longitude': convert_gps_to_decimal(gps.get(piexif.GPSIFD.GPSLongitude)),
    }
```

**Recommended:** Use `exiftool` via subprocess for most reliable extraction.

---

## Daily Report Format

### Format Specification

Daily reports are **plain text files** with **key:value pairs** (one per line).

**File extension:** `.txt`
**Filename pattern:** `{IMEI}-{DDMMYYYY}{HHMMSS}-dr.txt`
**Character encoding:** UTF-8

### Example Daily Report

**Source file:** `test-ftps-files/861943070068027-05122025154647-dr.txt`

```
IMEI:861943070068027
CSQ:31
CamID:
Temp:24℃
Date:05/12/2025 15:46:47
Battery:60%
SD:59405M/59628M
Total:159
Send:12
GPS:52.098737,5.125504
```

### Field Definitions

| Field | Type | Unit | Description | Example |
|-------|------|------|-------------|---------|
| **IMEI** | String | - | **Camera identifier** (equals Serial Number in EXIF) | `861943070068027` |
| **CSQ** | Integer | 0-31 | **Signal quality** (0=no signal, 31=excellent) | `31` |
| **CamID** | String | - | Camera ID field (often empty, not used) | `""` |
| **Temp** | Integer | °C | **Temperature** inside camera housing | `24` |
| **Date** | DateTime | - | Report generation timestamp | `05/12/2025 15:46:47` |
| **Battery** | Integer | % | **Battery percentage** (0-100%) | `60` |
| **SD** | String | MB | **SD card usage** in format `{used}M/{total}M` | `59405M/59628M` |
| **Total** | Integer | count | Total images captured by camera since deployment | `159` |
| **Send** | Integer | count | Total images successfully transmitted | `12` |
| **GPS** | String | lat,lon | **GPS coordinates** in decimal degrees | `52.098737,5.125504` |

### Field Notes

**CSQ (Signal Quality):**
- Scale: 0-31
- 0-9: Poor
- 10-19: Fair
- 20-25: Good
- 26-31: Excellent

**Battery:**
- Always includes `%` suffix
- Parse as integer: `int(value.rstrip('%'))`

**SD:**
- Format: `{used}M/{total}M` where M = megabytes
- Parse: Split on `/`, then strip `M` suffix
- Calculate utilization: `(used / total) * 100`

**Temperature:**
- Always includes `℃` suffix
- Parse as integer: `int(value.rstrip('℃ '))`
- Note: May have trailing space

**Date:**
- Format: `DD/MM/YYYY HH:MM:SS`
- Parse with: `datetime.strptime(value, '%d/%m/%Y %H:%M:%S')`

**GPS:**
- Format: `{latitude},{longitude}` (decimal degrees)
- Already in decimal format (no conversion needed)
- Latitude: Positive = North, Negative = South
- Longitude: Positive = East, Negative = West

### Parsing Daily Reports in Python

```python
from datetime import datetime
from typing import Dict, Optional

def parse_daily_report(filepath: str) -> Dict:
    """
    Parse daily report TXT file

    Args:
        filepath: Path to daily report file

    Returns:
        Dictionary with parsed data

    Raises:
        ValueError: If file format is invalid
    """
    data = {}

    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if ':' not in line:
                continue  # Skip lines without colon

            key, value = line.split(':', 1)
            data[key] = value

    # Validate required fields
    required_fields = ['IMEI', 'Battery', 'SD', 'Date']
    for field in required_fields:
        if field not in data:
            raise ValueError(f"Missing required field: {field}")

    # Parse and convert values
    try:
        parsed = {
            'imei': data['IMEI'],
            'battery_percent': int(data['Battery'].rstrip('%')),
            'temperature_c': int(data['Temp'].rstrip('℃ ').strip()) if 'Temp' in data else None,
            'signal_quality': int(data['CSQ']) if 'CSQ' in data else None,
            'timestamp': datetime.strptime(data['Date'], '%d/%m/%Y %H:%M:%S'),
            'total_images': int(data['Total']) if 'Total' in data else None,
            'images_sent': int(data['Send']) if 'Send' in data else None,
        }

        # Parse SD usage
        if 'SD' in data:
            sd_parts = data['SD'].split('/')
            parsed['sd_used_mb'] = int(sd_parts[0].rstrip('M'))
            parsed['sd_total_mb'] = int(sd_parts[1].rstrip('M'))

        # Parse GPS
        if 'GPS' in data and data['GPS']:
            gps_parts = data['GPS'].split(',')
            parsed['gps_latitude'] = float(gps_parts[0])
            parsed['gps_longitude'] = float(gps_parts[1])
        else:
            parsed['gps_latitude'] = None
            parsed['gps_longitude'] = None

        return parsed

    except (ValueError, IndexError) as e:
        raise ValueError(f"Failed to parse daily report: {e}")


def parse_daily_report_safe(filepath: str) -> Optional[Dict]:
    """
    Parse daily report with error handling

    Returns None if parsing fails (log error instead of crashing)
    """
    try:
        return parse_daily_report(filepath)
    except Exception as e:
        import logging
        logging.error(f"Failed to parse daily report {filepath}: {e}")
        return None
```

### Example Usage

```python
# Parse daily report
data = parse_daily_report('test-ftps-files/861943070068027-05122025154647-dr.txt')

print(data)
# Output:
# {
#     'imei': '861943070068027',
#     'battery_percent': 60,
#     'temperature_c': 24,
#     'signal_quality': 31,
#     'timestamp': datetime(2025, 12, 5, 15, 46, 47),
#     'sd_used_mb': 59405,
#     'sd_total_mb': 59628,
#     'total_images': 159,
#     'images_sent': 12,
#     'gps_latitude': 52.098737,
#     'gps_longitude': 5.125504
# }

# Calculate SD utilization percentage
sd_percent = (data['sd_used_mb'] / data['sd_total_mb']) * 100
print(f"SD Card: {sd_percent:.1f}% full")  # "SD Card: 99.6% full"
```

---

## Filename Conventions

### Image Filenames

**Pattern:** `E{7-digit-number}.JPG`

**Examples:**
- `E1000159.JPG`
- `E1000160.JPG`

**Notes:**
- Filenames do NOT contain camera identifier
- Camera identifier is only in EXIF `Serial Number` field
- Sequential numbering may reset after SD card format

### Daily Report Filenames

**Pattern:** `{IMEI}-{DDMMYYYY}{HHMMSS}-dr.txt`

**Components:**
- `{IMEI}`: Camera IMEI (15 digits)
- `{DDMMYYYY}`: Date (day, month, year)
- `{HHMMSS}`: Time (24-hour format)
- `-dr`: Daily report suffix
- `.txt`: Text file extension

**Examples:**
- `861943070068027-05122025154647-dr.txt`
  - IMEI: 861943070068027
  - Date: 05/12/2025 (December 5, 2025)
  - Time: 15:46:47 (3:46:47 PM)

### File Type Detection Logic

```python
def detect_file_type(filename: str) -> str:
    """
    Detect file type from filename

    Returns:
        'image' | 'daily_report' | 'unknown'
    """
    filename_lower = filename.lower()

    if filename_lower.endswith('-dr.txt'):
        return 'daily_report'
    elif filename_lower.endswith(('.jpg', '.jpeg')):
        return 'image'
    else:
        return 'unknown'


# Example usage
detect_file_type('E1000159.JPG')  # → 'image'
detect_file_type('861943070068027-05122025154647-dr.txt')  # → 'daily_report'
detect_file_type('readme.txt')  # → 'unknown'
```

---

## Parsing Examples

### Complete Ingestion Pipeline

```python
import os
from pathlib import Path
from typing import Optional

def process_uploaded_file(filepath: str):
    """
    Process a file uploaded via FTPS

    Routes to appropriate handler based on file type
    """
    filename = os.path.basename(filepath)
    file_type = detect_file_type(filename)

    if file_type == 'daily_report':
        process_daily_report(filepath)
    elif file_type == 'image':
        process_image(filepath)
    else:
        log.warning(f"Unknown file type: {filename}")


def process_daily_report(filepath: str):
    """Process daily report and update camera health"""
    # Parse report
    data = parse_daily_report(filepath)
    if not data:
        return  # Parsing failed

    # Find camera by IMEI
    camera = db.query(Camera).filter(
        Camera.serial_number == data['imei']
    ).first()

    if not camera:
        # Unknown device - add to queue
        handle_unknown_device(data, source='daily_report')
        return

    # Update camera health metrics
    camera.battery_percent = data['battery_percent']
    camera.sd_used_mb = data['sd_used_mb']
    camera.sd_total_mb = data['sd_total_mb']
    camera.temperature_c = data['temperature_c']
    camera.signal_quality = data['signal_quality']
    camera.last_daily_report_at = data['timestamp']
    camera.last_seen = datetime.now()

    # Update location if GPS present
    if data['gps_latitude'] and data['gps_longitude']:
        camera.location = f"POINT({data['gps_longitude']} {data['gps_latitude']})"

        # Also update placement plan actual location
        if camera.placement_plan:
            camera.placement_plan.actual_location = camera.location

    db.commit()

    # Check maintenance thresholds
    check_maintenance_thresholds(camera)

    log.info(f"Updated camera health from daily report: {camera.serial_number}")


def process_image(filepath: str):
    """Process image with EXIF extraction"""
    # Extract EXIF
    exif = extract_exif(filepath)

    if not exif or not exif['serial_number']:
        log.error(f"No serial number in EXIF: {filepath}")
        return

    # Find camera
    camera = db.query(Camera).filter(
        Camera.serial_number == exif['serial_number']
    ).first()

    if not camera:
        # Unknown device
        handle_unknown_device(exif, source='image')
        return

    # Generate UUID
    image_uuid = str(uuid.uuid4())

    # Upload to MinIO
    storage = StorageClient()
    storage_path = f"{image_uuid}.jpg"
    storage.upload_file(filepath, BUCKET_RAW_IMAGES, storage_path)

    # Create image record
    image = Image(
        uuid=image_uuid,
        filename=os.path.basename(filepath),
        camera_id=camera.id,
        project_id=camera.project_id,
        storage_path=storage_path,
        status='pending',
        image_metadata={
            'make': exif['make'],
            'model': exif['model'],
            'datetime_original': exif['datetime_original'],
            'gps_latitude': exif['gps_latitude'],
            'gps_longitude': exif['gps_longitude'],
        }
    )
    db.add(image)

    # Update camera
    camera.last_image_at = parse_datetime(exif['datetime_original'])
    camera.last_seen = datetime.now()

    # Update location from GPS
    if exif['gps_latitude'] and exif['gps_longitude']:
        camera.location = f"POINT({exif['gps_longitude']} {exif['gps_latitude']})"

        if camera.placement_plan:
            camera.placement_plan.actual_location = camera.location

    db.commit()

    # Queue for detection
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)
    queue.publish({
        'image_id': image.id,
        'uuid': image_uuid,
        'camera_id': camera.id,
        'storage_path': storage_path
    })

    log.info(f"Processed image: {image_uuid} from camera {camera.serial_number}")


def handle_unknown_device(data: dict, source: str):
    """Handle unknown device detection"""
    serial_number = data.get('imei') or data.get('serial_number')

    # Check if already in queue
    unknown = db.query(UnknownDevice).filter(
        UnknownDevice.serial_number == serial_number
    ).first()

    if unknown:
        # Update existing record
        unknown.last_contact_at = datetime.now()
        unknown.contact_count += 1
    else:
        # Create new record
        unknown = UnknownDevice(
            serial_number=serial_number,
            manufacturer=data.get('make'),
            model=data.get('model'),
            first_gps_location=f"POINT({data.get('gps_longitude')} {data.get('gps_latitude')})"
                if data.get('gps_latitude') and data.get('gps_longitude') else None,
            first_contact_at=datetime.now(),
            contact_count=1
        )
        db.add(unknown)

    db.commit()

    log.warning(f"Unknown device detected: {serial_number} (source: {source})")
```

---

## Error Handling

### Common Parsing Errors

**1. Missing EXIF Serial Number**
```python
# Image has no Serial Number field
Error: "No serial number in EXIF"
Action: Log error, skip image, alert admin
```

**2. Malformed Daily Report**
```python
# Missing required field
Error: "Missing required field: Battery"
Action: Log error, move file to /uploads/failed/, alert admin

# Invalid number format
Error: "Failed to parse daily report: invalid literal for int()"
Action: Log error with line number, skip this daily report
```

**3. GPS Coordinate Errors**
```python
# Invalid GPS format in daily report
Error: "GPS: invalid,coordinates"
Action: Set gps_latitude and gps_longitude to None, continue processing

# GPS out of valid range
Error: "GPS latitude 200.0 out of range (-90 to 90)"
Action: Log warning, set to None, continue processing
```

**4. Unknown Camera Identifier**
```python
# Camera not in database
Action: Insert into unknown_devices table, alert admin
Do NOT crash - this is expected for new cameras
```

### Validation Functions

```python
def validate_gps(latitude: float, longitude: float) -> bool:
    """Validate GPS coordinates are in valid range"""
    if latitude < -90 or latitude > 90:
        return False
    if longitude < -180 or longitude > 180:
        return False
    return True


def validate_battery(battery_percent: int) -> bool:
    """Validate battery percentage"""
    return 0 <= battery_percent <= 100


def validate_signal_quality(csq: int) -> bool:
    """Validate CSQ signal quality"""
    return 0 <= csq <= 31
```

### Error Recovery Strategy

**1. Transient Errors (network, temporary file access issues)**
- Retry up to 3 times with exponential backoff (1s, 2s, 4s)
- If still fails: Move to `/uploads/failed/` with error log

**2. Permanent Errors (invalid file format, corrupted data)**
- Log error immediately
- Move to `/uploads/failed/`
- Alert admin if many failures (>10 in 1 hour)

**3. Unknown Devices (not an error, expected)**
- Add to `unknown_devices` table
- Alert admin once per day with summary
- Continue normal operation

---

## Testing Data

### Sample Files for Testing

**Location:** `test-ftps-files/` directory

**Available files:**
1. `E1000159.JPG` - Sample camera trap image with full EXIF
2. `861943070068027-05122025154647-dr.txt` - Sample daily report
3. `exif_data.txt` - Full EXIF dump from exiftool

**Test scenarios:**
```python
# Test 1: Valid image with EXIF
process_image('test-ftps-files/E1000159.JPG')
# Expected: Camera 861943070068027 location updated

# Test 2: Valid daily report
process_daily_report('test-ftps-files/861943070068027-05122025154647-dr.txt')
# Expected: Camera health updated (battery 60%, SD 99.6% full)

# Test 3: Unknown device
# Create test file with unknown serial number
# Expected: Added to unknown_devices queue
```

---

## Additional Resources

**Tools:**
- ExifTool: https://exiftool.org/ (for EXIF extraction)
- Pillow: https://pillow.readthedocs.io/ (Python image library)
- piexif: https://pypi.org/project/piexif/ (EXIF manipulation)

**References:**
- EXIF Standard: https://www.exif.org/
- GPS Coordinate Systems: https://en.wikipedia.org/wiki/Geographic_coordinate_system
- PostGIS Geography Type: https://postgis.net/docs/geography.html

---

**Document Status:** ✅ Complete
**Last Updated:** December 9, 2025
