"""
Camera Profile System

Defines metadata extraction strategies for different camera trap models.
Each profile specifies how to identify the camera and extract required fields.
"""
from dataclasses import dataclass
from typing import Callable, Optional
import re


@dataclass
class CameraProfile:
    """
    Defines how to extract metadata from a specific camera model.

    Attributes:
        name: Human-readable camera model name
        make_pattern: Regex to match EXIF Make field (None = any)
        model_pattern: Regex to match EXIF Model field (None = any)
        get_camera_id: Function to extract camera identifier (returns str)
        requires_datetime: Whether DateTimeOriginal is mandatory
        requires_gps: Whether GPS coordinates are mandatory
    """
    name: str
    make_pattern: Optional[str]
    model_pattern: Optional[str]
    get_camera_id: Callable[[dict, str], Optional[str]]
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


def extract_swift_enduro_camera_id(exif: dict, filename: str) -> Optional[str]:
    """
    Extract camera ID from Swift Enduro cameras.

    Swift Enduro cameras do not store a serial number in EXIF.
    The IMEI (15-digit number) is embedded in the filename.

    Filename variants:
        WBC398      -868020035314870-10032026090126-4-SYPR0067.JPG  (with CamID)
        868020035314870-30032026102652-4-SYPR0260.JPG               (without CamID)

    Args:
        exif: EXIF metadata dictionary (unused for Swift Enduro)
        filename: Image filename containing IMEI

    Returns:
        IMEI as string, or None if not found
    """
    match = re.search(r'\b(\d{15})\b', filename)
    return match.group(1) if match else None


# Camera profile definitions
WILLFINE_2025_PROFILE = CameraProfile(
    name="Willfine-2025",
    make_pattern=r"Willfine",
    model_pattern=r"4\.0T CG",
    get_camera_id=extract_willfine_2025_camera_id,
    requires_datetime=True,
    requires_gps=True,
)

SWIFT_ENDURO_PROFILE = CameraProfile(
    name="Swift Enduro",
    make_pattern=r"SY",
    model_pattern=r"4\.0PCG-R",
    get_camera_id=extract_swift_enduro_camera_id,
    requires_datetime=True,
    requires_gps=True,
)

# Registry of all supported camera profiles
# Order matters: first match wins
CAMERA_PROFILES = [
    WILLFINE_2025_PROFILE,
    SWIFT_ENDURO_PROFILE,
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
