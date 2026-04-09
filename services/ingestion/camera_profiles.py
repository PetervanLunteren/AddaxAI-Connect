"""
Camera Profile System

Defines metadata extraction strategies for different camera trap models.

Two flavours of profile:

- **EXIF profiles** (Willfine, Swift Enduro) identify the camera by matching
  EXIF `Make`/`Model` and extract the device ID from EXIF or filename.
- **Path profiles** (INSTAR) identify the camera by matching the file's
  *relative path* under the upload directory and extract everything (device
  ID, GPS, datetime) from the path and filename. These cameras write no EXIF
  at all, so the EXIF-based identification flow is skipped entirely.
"""
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Optional
import re


@dataclass
class CameraProfile:
    """
    Defines how to extract metadata from a specific camera model.

    A profile is either EXIF-based or path-based:

    - EXIF-based: set `make_pattern` and/or `model_pattern`, and provide
      `get_camera_id`. Leave `path_pattern` and `parse_path` as None.
    - Path-based: set `path_pattern` and provide `parse_path`. Leave
      `make_pattern`, `model_pattern`, and `get_camera_id` as None.

    Attributes:
        name: Human-readable camera model name
        make_pattern: Regex to match EXIF Make field (EXIF profiles only)
        model_pattern: Regex to match EXIF Model field (EXIF profiles only)
        get_camera_id: Function returning device_id from EXIF + filename (EXIF profiles only)
        path_pattern: Regex to match the relative upload path (path profiles only)
        parse_path: Function returning {device_id, datetime, gps} from the relative path (path profiles only)
        requires_datetime: Whether DateTimeOriginal is mandatory
        requires_gps: Whether GPS coordinates are mandatory
    """
    name: str
    make_pattern: Optional[str] = None
    model_pattern: Optional[str] = None
    get_camera_id: Optional[Callable[[dict, str], Optional[str]]] = None
    path_pattern: Optional[str] = None
    parse_path: Optional[Callable[[str], dict]] = None
    requires_datetime: bool = True
    requires_gps: bool = False

    def __post_init__(self) -> None:
        is_path_profile = self.path_pattern is not None or self.parse_path is not None
        is_exif_profile = self.get_camera_id is not None

        if is_path_profile and is_exif_profile:
            raise ValueError(
                f"CameraProfile {self.name!r}: cannot be both EXIF-based and path-based"
            )
        if is_path_profile and not (self.path_pattern and self.parse_path):
            raise ValueError(
                f"CameraProfile {self.name!r}: path profiles require both path_pattern and parse_path"
            )
        if not is_path_profile and not is_exif_profile:
            raise ValueError(
                f"CameraProfile {self.name!r}: must provide either get_camera_id or (path_pattern + parse_path)"
            )

    @property
    def is_path_based(self) -> bool:
        return self.path_pattern is not None

    def matches_exif(self, exif: dict) -> bool:
        """
        Check if this EXIF profile matches the given EXIF data.

        Path profiles always return False here.
        """
        if self.is_path_based:
            return False

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

        return bool(make_matches and model_matches)

    def matches_path(self, relative_path: str) -> bool:
        """
        Check if this path profile matches the given relative upload path.

        EXIF profiles always return False here.
        """
        if not self.is_path_based:
            return False
        return bool(re.match(self.path_pattern, relative_path, re.IGNORECASE))


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


# ---------------------------------------------------------------------------
# INSTAR profile (path-based)
#
# INSTAR cameras write no EXIF. The admin sets the camera's "custom-path"
# field in the INSTAR web UI to:
#
#     INSTAR/lat<LAT>_lon<LON>
#
# e.g. ``INSTAR/lat52.02368_lon12.98290``. INSTAR drops every uploaded file
# straight into that directory:
#
#     /uploads/INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.jpeg
#     /uploads/INSTAR/lat52.02368_lon12.98290/A_2026-04-09_16-04-05.mp4
#
# The lat-lon dir is the only structure we rely on. Video clips land in the
# same directory as the stills and are deleted by the extension dispatcher
# (.mp4 → log + delete) before they ever reach parse_instar_path.
# ---------------------------------------------------------------------------

INSTAR_PATH_RE = re.compile(
    r"^INSTAR/lat(?P<lat>-?\d+\.\d+)_lon(?P<lon>-?\d+\.\d+)/[^/]+\.jpe?g$",
    re.IGNORECASE,
)

INSTAR_FILENAME_RE = re.compile(
    r"^[A-Z]_(?P<y>\d{4})-(?P<m>\d{2})-(?P<d>\d{2})_(?P<H>\d{2})-(?P<M>\d{2})-(?P<S>\d{2})\.jpe?g$",
    re.IGNORECASE,
)


def parse_instar_path(relative_path: str) -> dict:
    """
    Extract INSTAR metadata from the relative upload path.

    Args:
        relative_path: Path relative to the upload directory, using ``/`` as
            the separator (e.g. ``INSTAR/lat52.02368_lon12.98290/20260409/images/A_2026-04-09_16-04-05.jpeg``).

    Returns:
        Dict with keys ``device_id`` (str), ``datetime`` (datetime),
        ``gps`` (tuple[float, float]).

    Raises:
        ValueError: If the path or filename do not match the INSTAR format.
            Test-Snapshot.jpeg and similar non-timestamped files land here.
    """
    path_match = INSTAR_PATH_RE.match(relative_path)
    if not path_match:
        raise ValueError(f"Path does not match INSTAR layout: {relative_path}")

    lat = float(path_match.group("lat"))
    lon = float(path_match.group("lon"))

    # device_id is the lat-lon directory segment, verbatim. This is what the
    # admin types into Camera Management, so it must round-trip exactly.
    latlon_segment = relative_path.split("/")[1]

    filename = relative_path.rsplit("/", 1)[-1]
    file_match = INSTAR_FILENAME_RE.match(filename)
    if not file_match:
        raise ValueError(
            f"INSTAR filename has no timestamp: {filename!r} "
            f"(expected e.g. A_2026-04-09_16-04-05.jpeg)"
        )

    dt = datetime(
        year=int(file_match.group("y")),
        month=int(file_match.group("m")),
        day=int(file_match.group("d")),
        hour=int(file_match.group("H")),
        minute=int(file_match.group("M")),
        second=int(file_match.group("S")),
    )

    return {
        "device_id": latlon_segment,
        "datetime": dt,
        "gps": (lat, lon),
    }


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

INSTAR_PROFILE = CameraProfile(
    name="INSTAR",
    path_pattern=INSTAR_PATH_RE.pattern,
    parse_path=parse_instar_path,
    requires_datetime=True,
    requires_gps=True,
)

# Registry of all supported camera profiles.
# Path profiles are checked before EXIF profiles in identify_camera_profile.
CAMERA_PROFILES = [
    INSTAR_PROFILE,
    WILLFINE_2025_PROFILE,
    SWIFT_ENDURO_PROFILE,
]


def identify_camera_profile(exif: dict, filename: str, relative_path: str) -> CameraProfile:
    """
    Identify which camera profile matches this image.

    Path-based profiles are checked first against ``relative_path``. If none
    match, EXIF-based profiles are checked against the Make/Model in ``exif``.

    Args:
        exif: EXIF metadata dictionary (may be empty for path-based cameras)
        filename: Image filename
        relative_path: Path of the file relative to the upload directory,
            using ``/`` as the separator

    Returns:
        Matched CameraProfile

    Raises:
        ValueError: If no profile matches (unsupported camera)
    """
    for profile in CAMERA_PROFILES:
        if profile.is_path_based and profile.matches_path(relative_path):
            return profile

    for profile in CAMERA_PROFILES:
        if not profile.is_path_based and profile.matches_exif(exif):
            return profile

    raise ValueError(
        f"Unsupported camera. "
        f"Make: '{exif.get('Make')}', "
        f"Model: '{exif.get('Model')}', "
        f"Filename: '{filename}', "
        f"Path: '{relative_path}'. "
        f"Please add a new camera profile to support this camera."
    )
