"""
Camera Profile System

Defines metadata extraction strategies for different camera trap models.
Each profile specifies how to identify the camera and extract required fields.
"""
from dataclasses import dataclass
from typing import Callable, Optional, Tuple
import re


# Willfine-2024 Camera Serial Number Mapping
# Maps friendly names (with prefix) to serial numbers (IMEI)
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


@dataclass
class CameraProfile:
    """
    Defines how to extract metadata from a specific camera model.

    Attributes:
        name: Human-readable camera model name
        make_pattern: Regex to match EXIF Make field (None = any)
        model_pattern: Regex to match EXIF Model field (None = any)
        get_camera_id: Function to extract camera identifier
                       Returns either str (camera_id) or tuple (friendly_name, serial_number)
        requires_datetime: Whether DateTimeOriginal is mandatory
        requires_gps: Whether GPS coordinates are mandatory
    """
    name: str
    make_pattern: Optional[str]
    model_pattern: Optional[str]
    get_camera_id: Callable[[dict, str], Optional[str] | Optional[Tuple[str, str]]]
    requires_datetime: bool = True
    requires_gps: bool = False

    def matches(self, exif: dict) -> bool:
        """
        Check if this profile matches the given EXIF data.

        Args:
            exif: EXIF metadata dictionary

        Returns:
            True if Make/Model patterns match
        """
        make = exif.get('Make', '')
        model = exif.get('Model', '')

        make_matches = (
            not self.make_pattern or
            re.search(self.make_pattern, make, re.IGNORECASE)
        )
        model_matches = (
            not self.model_pattern or
            re.search(self.model_pattern, model, re.IGNORECASE)
        )

        return make_matches and model_matches


def extract_willfine_2025_camera_id(exif: dict, filename: str) -> Optional[str]:
    """
    Extract camera ID from Willfine-2025 cameras.

    Willfine-2025 cameras embed SerialNumber in EXIF metadata.

    Args:
        exif: EXIF metadata dictionary
        filename: Image filename (unused for Willfine-2025)

    Returns:
        Serial number as string, or None if not found
    """
    serial = exif.get('SerialNumber')
    return str(serial) if serial else None


def extract_willfine_2024_camera_id(exif: dict, filename: str) -> Optional[Tuple[str, str]]:
    """
    Extract camera ID and serial number from Willfine-2024 cameras.

    Willfine-2024 cameras don't have SerialNumber in EXIF, so extract from filename.
    Filename pattern: 0000000WUH09-SYPR1113.JPG
    Camera ID: WUH09
    Serial number: Looked up from WILLFINE_2024_SERIAL_MAPPING

    Args:
        exif: EXIF metadata dictionary (unused for Willfine-2024)
        filename: Image filename

    Returns:
        Tuple of (friendly_name, serial_number) e.g., ('WUH09', '860946063660255')
        or None if pattern doesn't match or serial number not in mapping

    Raises:
        ValueError: If camera not found in serial number mapping
    """
    # Pattern: Extract 3 letters + 2 digits (e.g., WUH09)
    match = re.search(r'([A-Z]{3}\d{2})', filename)
    if not match:
        return None

    friendly_name = match.group(1)  # e.g., 'WUH09'

    # Prepend zeros to create full key for mapping lookup
    full_key = f'0000000{friendly_name}'  # e.g., '0000000WUH09'

    # Look up serial number
    serial_number = WILLFINE_2024_SERIAL_MAPPING.get(full_key)
    if not serial_number:
        raise ValueError(
            f"Unknown Willfine-2024 camera: {friendly_name}. "
            f"Camera not found in serial number mapping. "
            f"Please add {full_key} to WILLFINE_2024_SERIAL_MAPPING."
        )

    return (friendly_name, serial_number)


# Camera profile definitions
WILLFINE_2025_PROFILE = CameraProfile(
    name="Willfine-2025",
    make_pattern=r"Willfine",
    model_pattern=r"4\.0T CG",
    get_camera_id=extract_willfine_2025_camera_id,
    requires_datetime=True,
    requires_gps=False,
)

WILLFINE_2024_PROFILE = CameraProfile(
    name="Willfine-2024",
    make_pattern=r"SY",
    model_pattern=r"4\.0PCG",
    get_camera_id=extract_willfine_2024_camera_id,
    requires_datetime=True,  # DateTimeOriginal now required
    requires_gps=False,
)

# Registry of all supported camera profiles
# Order matters: first match wins
CAMERA_PROFILES = [
    WILLFINE_2025_PROFILE,
    WILLFINE_2024_PROFILE,
]


def identify_camera_profile(exif: dict, filename: str) -> CameraProfile:
    """
    Identify which camera profile matches this image.

    Args:
        exif: EXIF metadata dictionary
        filename: Image filename

    Returns:
        Matched CameraProfile

    Raises:
        ValueError: If no profile matches (unsupported camera)
    """
    for profile in CAMERA_PROFILES:
        if profile.matches(exif):
            return profile

    # No profile matched - crash loudly
    raise ValueError(
        f"Unsupported camera model. "
        f"Make: '{exif.get('Make')}', "
        f"Model: '{exif.get('Model')}', "
        f"Filename: '{filename}'. "
        f"Please add a new camera profile to support this model."
    )
