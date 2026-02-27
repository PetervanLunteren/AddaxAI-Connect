#!/usr/bin/env python3
"""
Populate demo data for AddaxAI Connect.

Creates a complete demo dataset for De Hoge Veluwe National Park (Netherlands)
with ~100 cameras, ~50,000 images, detections, classifications, health reports,
and deployment periods spanning 2 years.

Usage:
    docker exec addaxai-api python /app/scripts/populate_demo_data.py

Set demo_mode: true in Ansible group_vars to auto-populate on deploy
and refresh daily via cron.
"""
import io
import json
import math
import os
import sys
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from random import Random

# Add shared module to path
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "api"))

from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from shared.config import get_settings
from shared.storage import BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS, StorageClient

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

RANDOM_SEED = 42
PROJECT_NAME = "De Hoge Veluwe"
PROJECT_DESCRIPTION = (
    "Camera trap monitoring of De Hoge Veluwe National Park, Netherlands. "
    "100 cameras deployed across 5,500 hectares of forest, heathland, and "
    "sand drifts, monitoring large mammals and mesocarnivores."
)

# Real park boundary polygon (lon, lat) - approximate De Hoge Veluwe boundary
PARK_BOUNDARY = [
    (5.810, 52.120),  # North (Hoenderloo)
    (5.835, 52.115),
    (5.855, 52.105),
    (5.868, 52.090),
    (5.875, 52.075),
    (5.870, 52.060),
    (5.860, 52.048),
    (5.845, 52.040),
    (5.825, 52.035),
    (5.808, 52.037),
    (5.790, 52.042),
    (5.778, 52.050),
    (5.772, 52.062),
    (5.770, 52.075),
    (5.773, 52.088),
    (5.780, 52.098),
    (5.790, 52.107),
    (5.800, 52.114),
    (5.810, 52.120),  # Close polygon
]

# Bounding box derived from park boundary
LAT_MIN = min(p[1] for p in PARK_BOUNDARY)
LAT_MAX = max(p[1] for p in PARK_BOUNDARY)
LON_MIN = min(p[0] for p in PARK_BOUNDARY)
LON_MAX = max(p[0] for p in PARK_BOUNDARY)

# Date range: ~2 years ending today
DATE_END = date.today()
DATE_START = DATE_END - timedelta(days=729)
NUM_DAYS = (DATE_END - DATE_START).days + 1

# Target number of cameras
NUM_CAMERAS_TARGET = 100

# Image generation rate
IMAGES_PER_CAMERA_PER_DAY = 0.7  # Poisson lambda

# Detection category distribution (non-empty images)
DETECTION_RATES = {
    "animal": 0.92,
    "person": 0.03,
    "vehicle": 0.005,
    # remaining ~4.5% = empty (no detection)
}

# Image and thumbnail dimensions
IMG_WIDTH, IMG_HEIGHT = 1920, 1440
THUMB_WIDTH, THUMB_HEIGHT = 300, 225

# MinIO placeholder paths
PLACEHOLDER_STORAGE_PATH = "demo/placeholder.jpg"
PLACEHOLDER_THUMBNAIL_PATH = "demo/placeholder.jpg"

# Demo users (passwords are random unless specified - those accounts exist for realistic data only)
DEMO_USERS = [
    {"email": "demo@email.com",             "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-admin", "password": "demo"},
    {"email": "admin@demo.addaxai.com",   "is_superuser": True,  "is_verified": True,  "is_active": True,  "role": "server-admin"},
    {"email": "j.devries@hogeveluwe.nl",  "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-admin"},
    {"email": "m.bakker@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-admin"},
    {"email": "s.jansen@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "l.visser@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "p.deboer@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "a.mulder@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "k.devos@hogeveluwe.nl",    "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "r.hendriks@hogeveluwe.nl", "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "n.smit@uu.nl",            "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "t.dejong@wur.nl",          "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "d.meijer@sovon.nl",        "is_superuser": False, "is_verified": True,  "is_active": True,  "role": "project-viewer"},
    {"email": "e.vandenberg@gmail.com",   "is_superuser": False, "is_verified": False, "is_active": True,  "role": "project-viewer"},
    {"email": "f.bos@outlook.com",        "is_superuser": False, "is_verified": False, "is_active": True,  "role": "project-viewer"},
    {"email": "b.willems@hogeveluwe.nl",  "is_superuser": False, "is_verified": True,  "is_active": False, "role": "project-viewer"},
    {"email": "c.kuiper@hogeveluwe.nl",   "is_superuser": False, "is_verified": True,  "is_active": False, "role": "project-viewer"},
]

# Species configuration
SPECIES_CONFIG = {
    "roe_deer":   {"weight": 0.25, "activity": "crepuscular", "zone": "everywhere",    "seasonal_peak": None},
    "fox":        {"weight": 0.15, "activity": "nocturnal",   "zone": "edges",         "seasonal_peak": None},
    "wild_boar":  {"weight": 0.14, "activity": "crepuscular", "zone": "south_east",    "seasonal_peak": "autumn"},
    "red_deer":   {"weight": 0.12, "activity": "crepuscular", "zone": "north",         "seasonal_peak": "autumn"},
    "lagomorph":  {"weight": 0.08, "activity": "diurnal",     "zone": "everywhere",    "seasonal_peak": "spring"},
    "fallow_deer":{"weight": 0.06, "activity": "crepuscular", "zone": "everywhere",    "seasonal_peak": "autumn"},
    "mouflon":    {"weight": 0.05, "activity": "crepuscular", "zone": "central_west",  "seasonal_peak": None},
    "bird":       {"weight": 0.05, "activity": "diurnal",     "zone": "everywhere",    "seasonal_peak": "summer"},
    "mustelid":   {"weight": 0.04, "activity": "nocturnal",   "zone": "everywhere",    "seasonal_peak": None},
    "wolf":       {"weight": 0.015,"activity": "nocturnal",   "zone": "north",         "seasonal_peak": None},
    "hedgehog":   {"weight": 0.015,"activity": "nocturnal",   "zone": "everywhere",    "seasonal_peak": "summer"},
    "squirrel":   {"weight": 0.015,"activity": "diurnal",     "zone": "everywhere",    "seasonal_peak": None},
    "cat":        {"weight": 0.01, "activity": "all_hours",   "zone": "edges",         "seasonal_peak": None},
    "dog":        {"weight": 0.005,"activity": "day_visitor",  "zone": "edges",         "seasonal_peak": "summer"},
}

ALL_SPECIES = list(SPECIES_CONFIG.keys())

# Activity patterns: hour -> relative probability (0-23)
ACTIVITY_PATTERNS = {
    "crepuscular": [
        0.1, 0.1, 0.1, 0.15, 0.3, 0.7, 1.0, 0.9, 0.6, 0.3,
        0.2, 0.15, 0.15, 0.15, 0.2, 0.4, 0.8, 1.0, 0.8, 0.5,
        0.3, 0.15, 0.1, 0.1,
    ],
    "nocturnal": [
        0.8, 0.9, 1.0, 0.9, 0.7, 0.3, 0.1, 0.05, 0.05, 0.05,
        0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.3, 0.5,
        0.7, 0.9, 1.0, 0.9,
    ],
    "diurnal": [
        0.05, 0.05, 0.05, 0.05, 0.05, 0.1, 0.2, 0.5, 0.8, 1.0,
        1.0, 1.0, 1.0, 1.0, 0.9, 0.7, 0.4, 0.2, 0.1, 0.05,
        0.05, 0.05, 0.05, 0.05,
    ],
    "day_visitor": [
        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.05, 0.2, 0.6,
        0.8, 1.0, 1.0, 1.0, 0.9, 0.7, 0.4, 0.1, 0.0, 0.0,
        0.0, 0.0, 0.0, 0.0,
    ],
    "all_hours": [
        0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.8,
        0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.7, 0.6, 0.6, 0.7,
        0.8, 0.7, 0.6, 0.5,
    ],
}

# Seasonal multipliers: species -> season -> multiplier
SEASON_MULTIPLIERS = {
    "lagomorph":   {"spring": 1.4},
    "bird":        {"spring": 1.3, "summer": 1.5},
    "hedgehog":    {"summer": 1.3},
    "dog":         {"summer": 1.5},
    "wild_boar":   {"autumn": 1.5},
    "red_deer":    {"autumn": 1.6},
    "fallow_deer": {"autumn": 1.5},
    "wolf":        {"winter": 1.2},
}
WINTER_GLOBAL_MULTIPLIER = 0.8

# Classification confidence ranges (common species get higher confidence)
CONFIDENCE_RANGES = {
    "roe_deer":    (0.75, 0.95),
    "fox":         (0.70, 0.94),
    "wild_boar":   (0.72, 0.95),
    "red_deer":    (0.73, 0.94),
    "lagomorph":   (0.65, 0.91),
    "fallow_deer": (0.68, 0.93),
    "mouflon":     (0.60, 0.90),
    "bird":        (0.55, 0.88),
    "mustelid":    (0.58, 0.89),
    "wolf":        (0.55, 0.88),
    "hedgehog":    (0.60, 0.89),
    "squirrel":    (0.62, 0.90),
    "cat":         (0.60, 0.90),
    "dog":         (0.65, 0.91),
}

# Real camera trap images from LILA BC (lila.science) public datasets.
# One representative photo per species for the demo gallery.
# bbox values are normalized [x_min, y_min, width, height] from MegaDetector v5a.
SPECIES_IMAGES = {
    "roe_deer": {
        "url": "https://storage.googleapis.com/public-datasets-lila/missouricameratraps/images/Set1/1.58-Roe_Deer/SEQ77011/SEQ77011_IMG_0003.JPG",
        "source": "Missouri Camera Traps",
        "bbox": [0.7954, 0.4342, 0.2016, 0.4296],
    },
    "fox": {
        "url": "https://storage.googleapis.com/public-datasets-lila/ena24/images/3254.jpg",
        "source": "ENA24",
        "bbox": [0.812, 0.7076, 0.1855, 0.2695],
    },
    "wild_boar": {
        "url": "https://storage.googleapis.com/public-datasets-lila/caltech-unzipped/cct_images/5971f933-23d2-11e8-a6a3-ec086b02610b.jpg",
        "source": "Caltech Camera Traps",
        "bbox": [0.5014, 0.3179, 0.4985, 0.6184],
    },
    "red_deer": {
        "url": "https://storage.googleapis.com/public-datasets-lila/missouricameratraps/images/Set1/1.57-Red_Deer/SEQ76971/SEQ76971_IMG_0005.JPG",
        "source": "Missouri Camera Traps",
        "bbox": [0.3339, 0.218, 0.2514, 0.3632],
    },
    "lagomorph": {
        "url": "https://storage.googleapis.com/public-datasets-lila/missouricameratraps/images/Set1/1.63-European_Hare/SEQ80662/SEQ80662_IMG_0005.JPG",
        "source": "Missouri Camera Traps",
        "bbox": [0.747, 0.4902, 0.07519, 0.04166],
    },
    "fallow_deer": {
        "url": "https://storage.googleapis.com/public-datasets-lila/snapshot-safari/CDB/CDB_public/CDB_S1/C05/C05_R1/CDB_S1_C05_R1_IMAG0190.JPG",
        "source": "Snapshot Safari",
        "bbox": [0.93, 0.42, 0.07, 0.22],
    },
    "mouflon": {
        "url": "https://storage.googleapis.com/public-datasets-lila/wcs-unzipped/animals/0002/0229.jpg",
        "source": "WCS Camera Traps",
        "bbox": [0.0, 0.0, 0.3007, 0.5214],
    },
    "bird": {
        "url": "https://storage.googleapis.com/public-datasets-lila/caltech-unzipped/cct_images/593bdc52-23d2-11e8-a6a3-ec086b02610b.jpg",
        "source": "Caltech Camera Traps",
        "bbox": [0.1416, 0.1519, 0.3876, 0.2757],
    },
    "mustelid": {
        "url": "https://storage.googleapis.com/public-datasets-lila/nacti-unzipped/part0/sub036/CA-03_08_13_2015_CA-03_0013883.jpg",
        "source": "NACTI",
        "bbox": [0.2011, 0.427, 0.2138, 0.1406],
    },
    "wolf": {
        "url": "https://storage.googleapis.com/public-datasets-lila/idaho-camera-traps/public/loc_0076/loc_0076_im_000336.jpg",
        "source": "Idaho Camera Traps",
        "bbox": [0.1481, 0.4735, 0.1192, 0.1171],
    },
    "hedgehog": {
        "url": "https://storage.googleapis.com/public-datasets-lila/nz-trailcams/CCP/hedgehog/106e5278-ea8b-41b3-aad9-7a1db0dd0e1f_000001.jpg",
        "source": "NZ Trailcams",
        "bbox": [0.5554, 0.4861, 0.1007, 0.2861],
    },
    "squirrel": {
        "url": "https://storage.googleapis.com/public-datasets-lila/caltech-unzipped/cct_images/5865e37e-23d2-11e8-a6a3-ec086b02610b.jpg",
        "source": "Caltech Camera Traps",
        "bbox": [0.3496, 0.3888, 0.0625, 0.06492],
    },
    "cat": {
        "url": "https://storage.googleapis.com/public-datasets-lila/caltech-unzipped/cct_images/58782b88-23d2-11e8-a6a3-ec086b02610b.jpg",
        "source": "Caltech Camera Traps",
        "bbox": [0.229, 0.3534, 0.06054, 0.1318],
    },
    "dog": {
        "url": "https://storage.googleapis.com/public-datasets-lila/caltech-unzipped/cct_images/590ebc34-23d2-11e8-a6a3-ec086b02610b.jpg",
        "source": "Caltech Camera Traps",
        "bbox": [0.7207, 0.7583, 0.1816, 0.2402],
    },
}

# Camera make/model
CAMERA_MAKE = "Willfine"
CAMERA_MODEL = "4.0CG"

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def get_season(d: date) -> str:
    """Map month to season name."""
    month = d.month
    if month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    elif month in (9, 10, 11):
        return "autumn"
    else:
        return "winter"


def point_in_polygon(x: float, y: float, polygon: list) -> bool:
    """Ray-casting point-in-polygon test. polygon is [(x, y), ...]."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def camera_zone(lat: float, lon: float) -> set:
    """Return zone tags for a camera based on its lat/lon position."""
    zones = set()
    if lat > 52.09:
        zones.add("north")
    if lat < 52.06 and lon > 5.83:
        zones.add("south_east")
    if 52.06 <= lat <= 52.09 and lon < 5.81:
        zones.add("central_west")
    if lat > 52.11 or lat < 52.045 or lon > 5.865 or lon < 5.780:
        zones.add("edges")
    zones.add("everywhere")
    return zones


def zone_weight(species_zone: str, cam_zones: set) -> float:
    """Spatial weighting: cameras in preferred zone get 2.5x, others get 1x."""
    if species_zone == "everywhere":
        return 1.0
    if species_zone in cam_zones:
        return 2.5
    return 0.4


def sample_hour(activity_type: str, rng: Random) -> int:
    """Weighted random hour from activity pattern."""
    weights = ACTIVITY_PATTERNS[activity_type]
    return rng.choices(range(24), weights=weights, k=1)[0]


def generate_placeholder_image() -> bytes:
    """Generate a nature-like gradient JPEG placeholder using Pillow."""
    try:
        from PIL import Image as PILImage
    except ImportError:
        # Fallback: minimal valid JPEG (1x1 pixel green)
        return (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01'
            b'\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07'
            b'\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14'
            b'\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f'
            b"'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
            b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00'
            b'\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08'
            b'\t\n\x0b\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03'
            b'\x05\x05\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12'
            b'!1A\x06\x13Qa\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1'
            b'\xf0$3br\x82\t\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJSTU'
            b'VWXYZcdefghijstuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93'
            b'\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4\xa5\xa6\xa7\xa8\xa9'
            b'\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2\xc3\xc4\xc5\xc6'
            b'\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xe1\xe2'
            b'\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5\xf6\xf7'
            b'\xf8\xf9\xfa\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd2\x8a'
            b'+\xff\xd9'
        )

    img = PILImage.new("RGB", (IMG_WIDTH, IMG_HEIGHT))
    pixels = img.load()
    for y in range(IMG_HEIGHT):
        for x in range(IMG_WIDTH):
            # Green-brown gradient (forest floor look)
            r = int(60 + 80 * (y / IMG_HEIGHT) + 20 * (x / IMG_WIDTH))
            g = int(90 + 50 * (1 - y / IMG_HEIGHT) + 15 * (x / IMG_WIDTH))
            b = int(40 + 30 * (y / IMG_HEIGHT))
            pixels[x, y] = (min(r, 255), min(g, 255), min(b, 255))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def generate_thumbnail(raw_bytes: bytes) -> bytes:
    """Resize image bytes to thumbnail dimensions."""
    try:
        from PIL import Image as PILImage
    except ImportError:
        return raw_bytes  # fallback: use raw as thumbnail

    img = PILImage.open(io.BytesIO(raw_bytes))
    img = img.resize((THUMB_WIDTH, THUMB_HEIGHT), PILImage.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return buf.getvalue()


def download_species_images(storage: "StorageClient") -> dict:
    """Download one real camera trap image per species from LILA BC.

    Uploads each image + thumbnail to MinIO under demo/{species}.jpg.
    Returns {species: {width, height, storage_path, thumbnail_path, bbox}} or
    {species: None} on download failure (caller falls back to placeholder).
    """
    from PIL import Image as PILImage

    result = {}
    for species, info in SPECIES_IMAGES.items():
        try:
            with urllib.request.urlopen(info["url"], timeout=30) as resp:
                raw_bytes = resp.read()

            img = PILImage.open(io.BytesIO(raw_bytes))
            width, height = img.size

            thumb_bytes = generate_thumbnail(raw_bytes)

            sp_storage_path = f"demo/{species}.jpg"
            sp_thumb_path = f"demo/{species}_thumb.jpg"

            storage.upload_fileobj(
                io.BytesIO(raw_bytes), BUCKET_RAW_IMAGES, sp_storage_path
            )
            storage.upload_fileobj(
                io.BytesIO(thumb_bytes), BUCKET_THUMBNAILS, sp_thumb_path
            )

            result[species] = {
                "width": width,
                "height": height,
                "storage_path": sp_storage_path,
                "thumbnail_path": sp_thumb_path,
                "bbox": info["bbox"],
            }
            print(f"      {species}: {width}x{height} ({len(raw_bytes) // 1024}KB)")
        except Exception as e:
            print(f"      {species}: download failed ({e}), using placeholder")
            result[species] = None

    return result


# ---------------------------------------------------------------------------
# Data generation functions
# ---------------------------------------------------------------------------

def generate_cameras() -> list:
    """Generate ~100 cameras inside the real park boundary polygon."""
    # Create a dense grid over the bounding box, filter points inside polygon
    grid_density = 16
    candidates = []
    lat_step = (LAT_MAX - LAT_MIN) / (grid_density - 1)
    lon_step = (LON_MAX - LON_MIN) / (grid_density - 1)

    for row in range(grid_density):
        for col in range(grid_density):
            lat = LAT_MIN + row * lat_step
            lon = LON_MIN + col * lon_step
            if point_in_polygon(lon, lat, PARK_BOUNDARY):
                candidates.append((round(lat, 6), round(lon, 6)))

    # Select evenly distributed subset to reach target count
    if len(candidates) > NUM_CAMERAS_TARGET:
        step = len(candidates) / NUM_CAMERAS_TARGET
        selected = [candidates[int(i * step)] for i in range(NUM_CAMERAS_TARGET)]
    else:
        selected = candidates

    cameras = []
    for idx, (lat, lon) in enumerate(selected):
        imei = f"DHV{idx + 1:03d}"
        cameras.append({
            "index": idx,
            "lat": lat,
            "lon": lon,
            "imei": imei,
            "name": f"Camera {imei}",
            "zones": camera_zone(lat, lon),
        })
    return cameras


def generate_all_data(cameras: list, rng: Random, species_image_info: dict):
    """
    Generate all images, detections, classifications for all cameras.

    Returns (images, detections, classifications) as lists of dicts.
    """
    all_images = []
    all_detections = []
    all_classifications = []

    image_id = 1
    detection_id = 1
    classification_id = 1
    img_counter = 1

    for cam in cameras:
        cam_zones = cam["zones"]

        for day_offset in range(NUM_DAYS):
            current_date = DATE_START + timedelta(days=day_offset)
            season = get_season(current_date)

            # Seasonal global multiplier
            rate = IMAGES_PER_CAMERA_PER_DAY
            if season == "winter":
                rate *= WINTER_GLOBAL_MULTIPLIER
            # Spatial activity variation for heatmap
            if "north" in cam_zones:
                rate *= 1.8
            elif "south_east" in cam_zones:
                rate *= 1.5
            elif "edges" in cam_zones:
                rate *= 0.6

            # Poisson draw for number of images this camera-day
            num_images = rng.choices(
                range(6),  # 0 to 5
                weights=[
                    math.exp(-rate) * (rate ** k) / math.factorial(k)
                    for k in range(6)
                ],
                k=1,
            )[0]

            for _ in range(num_images):
                # Decide detection category
                roll = rng.random()
                if roll < DETECTION_RATES["animal"]:
                    category = "animal"
                elif roll < DETECTION_RATES["animal"] + DETECTION_RATES["person"]:
                    category = "person"
                elif roll < DETECTION_RATES["animal"] + DETECTION_RATES["person"] + DETECTION_RATES["vehicle"]:
                    category = "vehicle"
                else:
                    category = None  # empty image

                # Select species (only for animal detections)
                species = None
                species_activity = "crepuscular"
                if category == "animal":
                    # Build weighted species list for this camera + season
                    weights = []
                    for sp, cfg in SPECIES_CONFIG.items():
                        w = cfg["weight"]
                        w *= zone_weight(cfg["zone"], cam_zones)
                        # Seasonal multiplier
                        sp_seasons = SEASON_MULTIPLIERS.get(sp, {})
                        if season in sp_seasons:
                            w *= sp_seasons[season]
                        weights.append(w)

                    species = rng.choices(ALL_SPECIES, weights=weights, k=1)[0]
                    species_activity = SPECIES_CONFIG[species]["activity"]
                elif category == "person":
                    species_activity = "day_visitor"
                elif category == "vehicle":
                    species_activity = "day_visitor"
                else:
                    species_activity = "diurnal"

                # Generate timestamp
                hour = sample_hour(species_activity, rng)
                minute = rng.randint(0, 59)
                second = rng.randint(0, 59)
                capture_dt = datetime(
                    current_date.year, current_date.month, current_date.day,
                    hour, minute, second,
                    tzinfo=timezone.utc,
                )

                # Generate deterministic UUID from seed
                img_uuid = str(uuid.UUID(int=rng.getrandbits(128), version=4))

                # Resolve image path and dimensions per species
                sp_info = None
                if category == "animal" and species:
                    sp_info = species_image_info.get(species)

                # For non-animal images, pick a random real species image
                if sp_info is None:
                    available = [v for v in species_image_info.values() if v is not None]
                    if available:
                        sp_info = rng.choice(available)

                if sp_info is not None:
                    img_storage_path = sp_info["storage_path"]
                    img_thumb_path = sp_info["thumbnail_path"]
                    img_w = sp_info["width"]
                    img_h = sp_info["height"]
                else:
                    img_storage_path = PLACEHOLDER_STORAGE_PATH
                    img_thumb_path = PLACEHOLDER_THUMBNAIL_PATH
                    img_w = IMG_WIDTH
                    img_h = IMG_HEIGHT

                # Image metadata (EXIF-like)
                dt_original = capture_dt.strftime("%Y:%m:%d %H:%M:%S")
                metadata = {
                    "width": img_w,
                    "height": img_h,
                    "gps_decimal": [cam["lat"], cam["lon"]],
                    "DateTimeOriginal": dt_original,
                    "Make": CAMERA_MAKE,
                    "Model": CAMERA_MODEL,
                    "SerialNumber": cam["imei"],
                }

                image_rec = {
                    "id": image_id,
                    "uuid": img_uuid,
                    "filename": f"IMG_{img_counter:06d}.JPG",
                    "camera_index": cam["index"],
                    "uploaded_at": capture_dt,
                    "storage_path": img_storage_path,
                    "thumbnail_path": img_thumb_path,
                    "status": "classified",
                    "image_metadata": json.dumps(metadata),
                }
                all_images.append(image_rec)

                # Generate detection (if not empty)
                if category is not None:
                    det_confidence = round(rng.uniform(0.3, 0.985), 4)

                    if sp_info is not None:
                        # Use real bbox from the species image
                        x_norm, y_norm, w_frac, h_frac = sp_info["bbox"]
                    elif category == "animal":
                        w_frac = rng.uniform(0.15, 0.40)
                        h_frac = rng.uniform(0.15, 0.40)
                    elif category == "person":
                        w_frac = rng.uniform(0.10, 0.25)
                        h_frac = rng.uniform(0.30, 0.60)
                    else:  # vehicle
                        w_frac = rng.uniform(0.20, 0.50)
                        h_frac = rng.uniform(0.15, 0.30)

                    if sp_info is None:
                        # Random position, clamped to image
                        max_x = 1.0 - w_frac
                        max_y = 1.0 - h_frac
                        x_norm = rng.uniform(0.0, max(max_x, 0.01))
                        y_norm = rng.uniform(0.0, max(max_y, 0.01))

                    x_px = int(x_norm * img_w)
                    y_px = int(y_norm * img_h)
                    w_px = int(w_frac * img_w)
                    h_px = int(h_frac * img_h)

                    bbox = {
                        "x_min": x_px,
                        "y_min": y_px,
                        "width": w_px,
                        "height": h_px,
                        "normalized": [
                            round(x_norm, 4),
                            round(y_norm, 4),
                            round(w_frac, 4),
                            round(h_frac, 4),
                        ],
                    }

                    det_rec = {
                        "id": detection_id,
                        "image_id": image_id,
                        "category": category,
                        "confidence": det_confidence,
                        "bbox": json.dumps(bbox),
                    }
                    all_detections.append(det_rec)

                    # Classification (only for animal detections)
                    if category == "animal" and species:
                        conf_lo, conf_hi = CONFIDENCE_RANGES.get(species, (0.55, 0.90))
                        cls_confidence = round(rng.uniform(conf_lo, conf_hi), 4)
                        cls_rec = {
                            "id": classification_id,
                            "detection_id": detection_id,
                            "species": species,
                            "confidence": cls_confidence,
                        }
                        all_classifications.append(cls_rec)
                        classification_id += 1

                    detection_id += 1

                image_id += 1
                img_counter += 1

    return all_images, all_detections, all_classifications


def generate_health_reports(cameras: list, rng: Random) -> list:
    """Generate daily health reports for all cameras."""
    reports = []
    report_id = 1

    for cam in cameras:
        battery = rng.uniform(85, 90)
        sd_util = 0.0
        total_images = 0
        sent_images = 0
        # Per-camera signal baseline
        signal_base = rng.randint(12, 22)
        # Vary when cameras last reported (not all today)
        days_short = rng.choices([0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 5], k=1)[0]

        for day_offset in range(NUM_DAYS - days_short):
            current_date = DATE_START + timedelta(days=day_offset)
            season = get_season(current_date)

            # Battery: decay + solar recharge
            battery -= rng.uniform(0.05, 0.25)
            if rng.random() < 0.40:  # solar recharge
                battery += rng.uniform(1.0, 5.0)
            battery = min(battery, 100.0)
            if battery < 15:
                battery = rng.uniform(85, 100)  # maintenance/replacement

            # Temperature: Dutch seasonal curve
            day_of_year = current_date.timetuple().tm_yday
            # Sine curve: peak ~July (day 195), trough ~Jan (day 15)
            temp_base = 10 + 10 * math.sin(2 * math.pi * (day_of_year - 100) / 365)
            temp = temp_base + rng.uniform(-3, 3)

            # Signal quality: baseline + noise
            signal = signal_base + rng.randint(-3, 3)
            signal = max(5, min(31, signal))

            # SD utilization: gradual increase, frequent resets (card swaps)
            daily_imgs = rng.randint(0, 3)
            total_images += daily_imgs
            sent_images += max(0, daily_imgs - rng.randint(0, 1))
            sd_util += daily_imgs * 0.003
            if sd_util > 8 or rng.random() < 0.03:
                sd_util = rng.uniform(0, 1)  # card swap or cleanup
            sd_util = min(sd_util, 15.0)

            reports.append({
                "id": report_id,
                "camera_index": cam["index"],
                "report_date": current_date,
                "battery_percent": max(0, min(100, int(battery))),
                "signal_quality": signal,
                "temperature_c": int(round(temp)),
                "sd_utilization_percent": round(sd_util, 1),
                "total_images": total_images,
                "sent_images": min(sent_images, total_images),
            })
            report_id += 1

    return reports


def curate_first_page(images, detections, classifications, species_image_info, rng):
    """Ensure the first page (24 most recent images) shows all 14 species
    with no two consecutive images having the same species."""
    FRONT_PAGE_SIZE = 24

    # Build lookups: image_id -> detection, detection_id -> classification
    img_to_det = {}
    for det in detections:
        if det["category"] == "animal":
            img_to_det[det["image_id"]] = det
    det_to_cls = {}
    for cls in classifications:
        det_to_cls[cls["detection_id"]] = cls

    # Find animal images that have classifications
    animal_images = []
    for img in images:
        det = img_to_det.get(img["id"])
        if det:
            cls = det_to_cls.get(det["id"])
            if cls:
                animal_images.append((img, det, cls))

    # Sort by uploaded_at desc and pick top candidates
    animal_images.sort(key=lambda x: x[0]["uploaded_at"], reverse=True)
    selected = animal_images[:FRONT_PAGE_SIZE]

    # Build species sequence: all 14 species, then fill to 24, no consecutive dupes
    all_sp = list(ALL_SPECIES)
    rng.shuffle(all_sp)
    sequence = list(all_sp)  # 14 unique species
    while len(sequence) < FRONT_PAGE_SIZE:
        candidates = [s for s in all_sp if s != sequence[-1]]
        sequence.append(rng.choice(candidates))
    # Fix any consecutive duplicates at the boundary
    for i in range(1, len(sequence)):
        if sequence[i] == sequence[i - 1]:
            candidates = [s for s in all_sp if s != sequence[i - 1]]
            if i + 1 < len(sequence):
                candidates = [c for c in candidates if c != sequence[i + 1]]
            sequence[i] = rng.choice(candidates)

    # Make these 24 images the most recent by bumping their timestamps
    max_ts = max(img["uploaded_at"] for img in images)
    for i, ((img, det, cls), species) in enumerate(zip(selected, sequence)):
        # Index 0 = most recent on the page (highest timestamp)
        new_ts = max_ts + timedelta(minutes=FRONT_PAGE_SIZE - i)
        img["uploaded_at"] = new_ts

        # Update image paths and metadata for the new species
        sp_info = species_image_info.get(species)
        if sp_info:
            img["storage_path"] = sp_info["storage_path"]
            img["thumbnail_path"] = sp_info["thumbnail_path"]
            meta = json.loads(img["image_metadata"])
            meta["width"] = sp_info["width"]
            meta["height"] = sp_info["height"]
            meta["DateTimeOriginal"] = new_ts.strftime("%Y:%m:%d %H:%M:%S")
            img["image_metadata"] = json.dumps(meta)

            # Update detection bbox from the real species image
            x_norm, y_norm, w_frac, h_frac = sp_info["bbox"]
            bbox = {
                "x_min": int(x_norm * sp_info["width"]),
                "y_min": int(y_norm * sp_info["height"]),
                "width": int(w_frac * sp_info["width"]),
                "height": int(h_frac * sp_info["height"]),
                "normalized": [
                    round(x_norm, 4), round(y_norm, 4),
                    round(w_frac, 4), round(h_frac, 4),
                ],
            }
            det["bbox"] = json.dumps(bbox)

        # Update classification species and confidence
        conf_lo, conf_hi = CONFIDENCE_RANGES.get(species, (0.55, 0.90))
        cls["species"] = species
        cls["confidence"] = round(rng.uniform(conf_lo, conf_hi), 4)


def generate_deployment_periods(cameras: list) -> list:
    """Generate one active deployment per camera."""
    periods = []
    for i, cam in enumerate(cameras):
        periods.append({
            "id": i + 1,
            "camera_index": cam["index"],
            "deployment_id": 1,
            "start_date": DATE_START,
            "end_date": None,
            "lat": cam["lat"],
            "lon": cam["lon"],
        })
    return periods


# ---------------------------------------------------------------------------
# Database functions
# ---------------------------------------------------------------------------

def clean_demo_data(session: Session):
    """Delete existing demo data by project name (respecting FK order)."""
    project_row = session.execute(
        text("SELECT id FROM projects WHERE name = :name"),
        {"name": PROJECT_NAME},
    ).fetchone()

    if project_row:
        project_id = project_row[0]
        print(f"   Found existing project id={project_id}, cleaning...")

        # Get camera IDs for this project
        cam_rows = session.execute(
            text("SELECT id FROM cameras WHERE project_id = :pid"),
            {"pid": project_id},
        ).fetchall()
        cam_ids = [r[0] for r in cam_rows]

        if cam_ids:
            cam_ids_str = ",".join(str(c) for c in cam_ids)

            # Get image IDs
            img_rows = session.execute(
                text(f"SELECT id FROM images WHERE camera_id IN ({cam_ids_str})")
            ).fetchall()
            img_ids = [r[0] for r in img_rows]

            if img_ids:
                # Delete in chunks to avoid huge queries
                for i in range(0, len(img_ids), 5000):
                    chunk = img_ids[i:i + 5000]
                    chunk_str = ",".join(str(x) for x in chunk)

                    # Get detection IDs for this chunk
                    det_rows = session.execute(
                        text(f"SELECT id FROM detections WHERE image_id IN ({chunk_str})")
                    ).fetchall()
                    det_ids = [r[0] for r in det_rows]

                    if det_ids:
                        for j in range(0, len(det_ids), 5000):
                            det_chunk = det_ids[j:j + 5000]
                            det_chunk_str = ",".join(str(x) for x in det_chunk)
                            session.execute(text(f"DELETE FROM classifications WHERE detection_id IN ({det_chunk_str})"))
                            session.execute(text(f"DELETE FROM detections WHERE id IN ({det_chunk_str})"))

                    session.execute(text(f"DELETE FROM images WHERE id IN ({chunk_str})"))

            # Delete camera-related data
            session.execute(text(f"DELETE FROM camera_health_reports WHERE camera_id IN ({cam_ids_str})"))
            session.execute(text(f"DELETE FROM camera_deployment_periods WHERE camera_id IN ({cam_ids_str})"))
            session.execute(text(f"DELETE FROM cameras WHERE id IN ({cam_ids_str})"))

        # Delete notification preferences and project memberships
        session.execute(text("DELETE FROM project_notification_preferences WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM project_memberships WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM projects WHERE id = :pid"), {"pid": project_id})
    else:
        print("   No existing demo project found.")

    # Delete telegram config (global, not per-project)
    session.execute(text("DELETE FROM telegram_config"))

    # Delete demo users and their telegram linking tokens
    for user_info in DEMO_USERS:
        user_row = session.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": user_info["email"]},
        ).fetchone()
        if user_row:
            session.execute(
                text("DELETE FROM telegram_linking_tokens WHERE user_id = :uid"),
                {"uid": user_row[0]},
            )
            session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_row[0]})

    # Clean up legacy demo user from previous script version
    session.execute(text("DELETE FROM users WHERE email = 'viewer@demo.addaxai.com'"))

    session.flush()
    print("   Cleanup complete.")


def insert_project(session: Session) -> int:
    """Create project with PostGIS polygon boundary from real park shape."""
    coords = ", ".join(f"{lon} {lat}" for lon, lat in PARK_BOUNDARY)
    boundary_wkt = f"POLYGON(({coords}))"
    result = session.execute(
        text("""
            INSERT INTO projects (
                name, description, location, included_species,
                detection_threshold, blur_people_vehicles,
                independence_interval_minutes
            ) VALUES (
                :name, :description, ST_GeogFromText(:boundary),
                :species, :threshold, :blur, :independence
            ) RETURNING id
        """),
        {
            "name": PROJECT_NAME,
            "description": PROJECT_DESCRIPTION,
            "species": json.dumps(ALL_SPECIES),
            "boundary": boundary_wkt,
            "threshold": 0.5,
            "blur": True,
            "independence": 30,
        },
    )
    project_id = result.fetchone()[0]
    session.flush()
    return project_id


def set_project_image(
    session: Session, project_id: int, species_image_info: dict
) -> None:
    """Download roe deer image from MinIO and set it as the project image."""
    roe_deer_info = species_image_info.get("roe_deer")
    if roe_deer_info is None:
        print("   Skipping project image (roe deer image not available).")
        return

    PROJECT_IMAGES_DIR = "/app/project-images"
    os.makedirs(PROJECT_IMAGES_DIR, exist_ok=True)

    storage = StorageClient()
    raw_bytes = storage.download_fileobj(
        BUCKET_RAW_IMAGES, roe_deer_info["storage_path"]
    )

    image_filename = f"project_{project_id}.jpg"
    thumbnail_filename = f"project_{project_id}_thumb.jpg"

    # Save original
    with open(os.path.join(PROJECT_IMAGES_DIR, image_filename), "wb") as f:
        f.write(raw_bytes)

    # Generate and save thumbnail (reuse existing helper)
    thumb_bytes = generate_thumbnail(raw_bytes)
    with open(os.path.join(PROJECT_IMAGES_DIR, thumbnail_filename), "wb") as f:
        f.write(thumb_bytes)

    # Update project row
    session.execute(
        text(
            "UPDATE projects SET image_path = :img, thumbnail_path = :thumb WHERE id = :id"
        ),
        {"img": image_filename, "thumb": thumbnail_filename, "id": project_id},
    )
    session.flush()
    print(f"   Project image set ({image_filename}).")


def insert_users(session: Session, project_id: int) -> dict:
    """Create 16 demo users and project memberships. Returns {email: user_id}."""
    random_pw_hash = pwd_context.hash(str(uuid.uuid4()))
    user_ids = {}
    admin_id = None

    for user_info in DEMO_USERS:
        pw_hash = pwd_context.hash(user_info["password"]) if "password" in user_info else random_pw_hash
        result = session.execute(
            text("""
                INSERT INTO users (email, hashed_password, is_active, is_superuser, is_verified)
                VALUES (:email, :pw, :active, :superuser, :verified)
                RETURNING id
            """),
            {
                "email": user_info["email"],
                "pw": pw_hash,
                "active": user_info["is_active"],
                "superuser": user_info["is_superuser"],
                "verified": user_info["is_verified"],
            },
        )
        user_id = result.fetchone()[0]
        user_ids[user_info["email"]] = user_id
        if user_info["is_superuser"]:
            admin_id = user_id

    # Create project memberships for active+verified non-superuser users
    for user_info in DEMO_USERS:
        if user_info["is_superuser"]:
            continue
        if not user_info["is_active"] or not user_info["is_verified"]:
            continue
        session.execute(
            text("""
                INSERT INTO project_memberships (user_id, project_id, role, added_by_user_id)
                VALUES (:uid, :pid, :role, :admin_id)
            """),
            {
                "uid": user_ids[user_info["email"]],
                "pid": project_id,
                "role": user_info["role"],
                "admin_id": admin_id,
            },
        )

    session.flush()
    return user_ids


def insert_cameras(session: Session, cameras: list, project_id: int) -> dict:
    """Bulk insert cameras. Returns {camera_index: db_id} mapping."""
    index_to_id = {}
    for cam in cameras:
        result = session.execute(
            text("""
                INSERT INTO cameras (
                    name, imei, manufacturer, model, project_id,
                    status, location, installed_at
                ) VALUES (
                    :name, :imei, :make, :model, :pid,
                    'active',
                    ST_GeogFromText(:loc), :installed
                ) RETURNING id
            """),
            {
                "name": cam["name"],
                "imei": cam["imei"],
                "make": CAMERA_MAKE,
                "model": CAMERA_MODEL,
                "pid": project_id,
                "loc": f"POINT({cam['lon']} {cam['lat']})",
                "installed": datetime(DATE_START.year, DATE_START.month, DATE_START.day, tzinfo=timezone.utc),
            },
        )
        db_id = result.fetchone()[0]
        index_to_id[cam["index"]] = db_id
    session.flush()
    return index_to_id


def insert_images_batch(session: Session, images: list, cam_index_to_id: dict):
    """Batch insert images using raw SQL in chunks."""
    chunk_size = 2000
    for i in range(0, len(images), chunk_size):
        chunk = images[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, img in enumerate(chunk):
            key = f"_{i + j}"
            values_parts.append(
                f"(:uuid{key}, :filename{key}, :camera_id{key}, :uploaded_at{key}, "
                f":storage_path{key}, :thumbnail_path{key}, :status{key}, "
                f"CAST(:metadata{key} AS jsonb), false)"
            )
            params[f"uuid{key}"] = img["uuid"]
            params[f"filename{key}"] = img["filename"]
            params[f"camera_id{key}"] = cam_index_to_id[img["camera_index"]]
            params[f"uploaded_at{key}"] = img["uploaded_at"]
            params[f"storage_path{key}"] = img["storage_path"]
            params[f"thumbnail_path{key}"] = img["thumbnail_path"]
            params[f"status{key}"] = img["status"]
            params[f"metadata{key}"] = img["image_metadata"]

        sql = (
            "INSERT INTO images (uuid, filename, camera_id, uploaded_at, "
            "storage_path, thumbnail_path, status, image_metadata, is_verified) VALUES "
            + ", ".join(values_parts)
        )
        session.execute(text(sql), params)

    session.flush()

    # Build image uuid -> db_id mapping
    rows = session.execute(
        text("SELECT uuid, id FROM images WHERE storage_path LIKE 'demo/%'"),
    ).fetchall()
    uuid_to_id = {r[0]: r[1] for r in rows}
    return uuid_to_id


def insert_detections_batch(session: Session, detections: list, image_uuid_to_id: dict, images: list):
    """Batch insert detections. Returns {old_detection_id: db_detection_id} mapping."""
    # Build old_image_id -> uuid mapping
    old_img_id_to_uuid = {img["id"]: img["uuid"] for img in images}

    chunk_size = 2000
    old_to_new_det = {}

    for i in range(0, len(detections), chunk_size):
        chunk = detections[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, det in enumerate(chunk):
            key = f"_{i + j}"
            img_uuid = old_img_id_to_uuid[det["image_id"]]
            db_image_id = image_uuid_to_id[img_uuid]
            values_parts.append(
                f"(:image_id{key}, :category{key}, CAST(:bbox{key} AS jsonb), :confidence{key})"
            )
            params[f"image_id{key}"] = db_image_id
            params[f"category{key}"] = det["category"]
            params[f"bbox{key}"] = det["bbox"]
            params[f"confidence{key}"] = det["confidence"]

        sql = (
            "INSERT INTO detections (image_id, category, bbox, confidence) VALUES "
            + ", ".join(values_parts)
            + " RETURNING id"
        )
        result = session.execute(text(sql), params)
        new_ids = [r[0] for r in result.fetchall()]

        for j, det in enumerate(chunk):
            old_to_new_det[det["id"]] = new_ids[j]

    session.flush()
    return old_to_new_det


def insert_classifications_batch(session: Session, classifications: list, old_to_new_det: dict):
    """Batch insert classifications."""
    chunk_size = 2000
    for i in range(0, len(classifications), chunk_size):
        chunk = classifications[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, cls in enumerate(chunk):
            key = f"_{i + j}"
            values_parts.append(
                f"(:detection_id{key}, :species{key}, :confidence{key})"
            )
            params[f"detection_id{key}"] = old_to_new_det[cls["detection_id"]]
            params[f"species{key}"] = cls["species"]
            params[f"confidence{key}"] = cls["confidence"]

        sql = (
            "INSERT INTO classifications (detection_id, species, confidence) VALUES "
            + ", ".join(values_parts)
        )
        session.execute(text(sql), params)

    session.flush()


def insert_health_reports_batch(session: Session, reports: list, cam_index_to_id: dict):
    """Batch insert health reports."""
    chunk_size = 5000
    for i in range(0, len(reports), chunk_size):
        chunk = reports[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, rep in enumerate(chunk):
            key = f"_{i + j}"
            values_parts.append(
                f"(:camera_id{key}, :report_date{key}, :battery{key}, "
                f":signal{key}, :temp{key}, :sd{key}, :total{key}, :sent{key})"
            )
            params[f"camera_id{key}"] = cam_index_to_id[rep["camera_index"]]
            params[f"report_date{key}"] = rep["report_date"]
            params[f"battery{key}"] = rep["battery_percent"]
            params[f"signal{key}"] = rep["signal_quality"]
            params[f"temp{key}"] = rep["temperature_c"]
            params[f"sd{key}"] = rep["sd_utilization_percent"]
            params[f"total{key}"] = rep["total_images"]
            params[f"sent{key}"] = rep["sent_images"]

        sql = (
            "INSERT INTO camera_health_reports "
            "(camera_id, report_date, battery_percent, signal_quality, "
            "temperature_c, sd_utilization_percent, total_images, sent_images) VALUES "
            + ", ".join(values_parts)
        )
        session.execute(text(sql), params)

    session.flush()


def insert_deployment_periods(session: Session, periods: list, cam_index_to_id: dict):
    """Insert deployment periods."""
    for period in periods:
        session.execute(
            text("""
                INSERT INTO camera_deployment_periods (
                    camera_id, deployment_id, start_date, end_date, location
                ) VALUES (
                    :camera_id, :dep_id, :start, :end,
                    ST_GeogFromText(:loc)
                )
            """),
            {
                "camera_id": cam_index_to_id[period["camera_index"]],
                "dep_id": period["deployment_id"],
                "start": period["start_date"],
                "end": period["end_date"],
                "loc": f"POINT({period['lon']} {period['lat']})",
            },
        )
    session.flush()


def update_camera_latest_fields(session: Session, cam_index_to_id: dict, cameras: list):
    """Update cameras with latest health/image data and config JSON."""
    cam_by_index = {cam["index"]: cam for cam in cameras}

    for cam_index, cam_db_id in cam_index_to_id.items():
        cam = cam_by_index[cam_index]

        # Get latest health report for this camera
        latest = session.execute(
            text("""
                SELECT battery_percent, signal_quality, temperature_c,
                       sd_utilization_percent, total_images, sent_images,
                       report_date
                FROM camera_health_reports
                WHERE camera_id = :cid
                ORDER BY report_date DESC LIMIT 1
            """),
            {"cid": cam_db_id},
        ).fetchone()

        config = None
        last_daily_report_at = None
        battery = None
        temp = None
        signal = None

        if latest:
            battery = latest[0]
            signal = latest[1]
            temp = latest[2]

            # Hour variation per camera (not all at midnight)
            report_hour = (cam_index * 7 + 3) % 24
            report_minute = (cam_index * 13) % 60
            last_daily_report_at = datetime(
                latest[6].year, latest[6].month, latest[6].day,
                report_hour, report_minute, 0,
                tzinfo=timezone.utc,
            )

            config = {
                "last_health_report": {
                    "signal_quality": signal,
                    "temperature": temp,
                    "battery_percentage": battery,
                    "sd_utilization_percentage": latest[3],
                    "total_images": latest[4],
                    "sent_images": latest[5],
                },
                "last_report_timestamp": last_daily_report_at.isoformat(),
                "gps_from_report": {
                    "lat": cam["lat"],
                    "lon": cam["lon"],
                },
            }

        session.execute(
            text("""
                UPDATE cameras SET
                    last_image_at = (
                        SELECT MAX(uploaded_at) FROM images WHERE camera_id = :cid
                    ),
                    last_seen = (
                        SELECT MAX(uploaded_at) FROM images WHERE camera_id = :cid
                    ),
                    last_daily_report_at = :last_report_at,
                    battery_percent = :battery,
                    temperature_c = :temp,
                    signal_quality = :signal,
                    config = CAST(:config AS json)
                WHERE id = :cid
            """),
            {
                "cid": cam_db_id,
                "last_report_at": last_daily_report_at,
                "battery": battery,
                "temp": temp,
                "signal": signal,
                "config": json.dumps(config) if config else None,
            },
        )
    session.flush()


def insert_telegram_config(session: Session):
    """Insert Telegram bot configuration for the demo."""
    session.execute(
        text("""
            INSERT INTO telegram_config (
                bot_token, bot_username, is_configured,
                health_status, last_health_check
            ) VALUES (
                :token, :username, true, 'healthy', :last_check
            )
        """),
        {
            "token": "7483920156:AAH_demo_bot_token_not_real_k9x2m",
            "username": "AddaxAI_HogeVeluwe_bot",
            "last_check": datetime.now(timezone.utc) - timedelta(minutes=15),
        },
    )
    session.flush()


def insert_notification_preferences(session: Session, project_id: int, user_ids: dict):
    """Insert notification preferences for a few demo users."""
    notif_users = [
        ("j.devries@hogeveluwe.nl", "100001"),
        ("m.bakker@hogeveluwe.nl",  "100002"),
        ("s.jansen@hogeveluwe.nl",  "100003"),
        ("n.smit@uu.nl",            "100004"),
    ]

    for email, chat_id in notif_users:
        if email not in user_ids:
            continue

        channels = {
            "species_alert": {
                "enabled": True,
                "channels": ["telegram"],
                "species": ["wolf", "wild_boar"],
            },
            "low_battery": {
                "enabled": True,
                "channels": ["telegram"],
                "threshold": 20,
            },
        }

        session.execute(
            text("""
                INSERT INTO project_notification_preferences (
                    user_id, project_id, enabled, telegram_chat_id,
                    notification_channels
                ) VALUES (
                    :uid, :pid, true, :chat_id,
                    CAST(:channels AS json)
                )
            """),
            {
                "uid": user_ids[email],
                "pid": project_id,
                "chat_id": chat_id,
                "channels": json.dumps(channels),
            },
        )

    # Mock-link Telegram for the server admin if present on this instance
    admin_row = session.execute(
        text("SELECT id FROM users WHERE email = 'peter@addaxdatascience.com'"),
    ).fetchone()
    if admin_row:
        admin_channels = {
            "species_alert": {
                "enabled": True,
                "channels": ["telegram"],
                "species": ["wolf", "wild_boar", "red_deer"],
            },
            "low_battery": {
                "enabled": True,
                "channels": ["telegram"],
                "threshold": 20,
            },
        }
        session.execute(
            text("DELETE FROM project_notification_preferences WHERE user_id = :uid AND project_id = :pid"),
            {"uid": admin_row[0], "pid": project_id},
        )
        session.execute(
            text("""
                INSERT INTO project_notification_preferences (
                    user_id, project_id, enabled, telegram_chat_id,
                    notification_channels
                ) VALUES (
                    :uid, :pid, true, :chat_id,
                    CAST(:channels AS json)
                )
            """),
            {
                "uid": admin_row[0],
                "pid": project_id,
                "chat_id": "100000",
                "channels": json.dumps(admin_channels),
            },
        )

    session.flush()


# ---------------------------------------------------------------------------
# MinIO function
# ---------------------------------------------------------------------------

def upload_demo_images() -> dict:
    """Upload placeholder + per-species real images to MinIO.

    Returns species_image_info dict from download_species_images().
    """
    storage = StorageClient()

    # Placeholder (still used for person/vehicle/empty images)
    raw_bytes = generate_placeholder_image()
    thumb_bytes = generate_thumbnail(raw_bytes)
    storage.upload_fileobj(
        io.BytesIO(raw_bytes), BUCKET_RAW_IMAGES, PLACEHOLDER_STORAGE_PATH
    )
    storage.upload_fileobj(
        io.BytesIO(thumb_bytes), BUCKET_THUMBNAILS, PLACEHOLDER_THUMBNAIL_PATH
    )

    # Real species images
    print("   Downloading species images from LILA BC...")
    species_image_info = download_species_images(storage)
    downloaded = sum(1 for v in species_image_info.values() if v is not None)
    print(f"   {downloaded}/{len(SPECIES_IMAGES)} species images downloaded.")

    return species_image_info


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def main():
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    rng = Random(RANDOM_SEED)

    print("=" * 60)
    print("  AddaxAI Connect - Demo Data Population")
    print("=" * 60)
    print()

    # Step 1: MinIO
    print("[1/9] Uploading demo images to MinIO...")
    species_image_info = upload_demo_images()
    print("   Done.")

    with Session(engine) as session:
        # Step 2: Clean
        print("[2/9] Cleaning existing demo data...")
        clean_demo_data(session)
        session.commit()

        # Step 3: Project
        print("[3/9] Creating project...")
        project_id = insert_project(session)
        print(f"   Project '{PROJECT_NAME}' created (id={project_id}).")
        set_project_image(session, project_id, species_image_info)

        # Step 4: Users
        print("[4/9] Creating users...")
        user_ids = insert_users(session, project_id)
        print(f"   {len(user_ids)} users created.")
        for u in DEMO_USERS[:3]:
            print(f"   - {u['email']} ({u['role']})")
        print(f"   - ... and {len(DEMO_USERS) - 3} more")

        # Step 5: Generate data in memory
        print("[5/9] Generating all data in memory...")
        cameras = generate_cameras()
        print(f"   {len(cameras)} cameras defined.")

        images, detections, classifications = generate_all_data(cameras, rng, species_image_info)
        print(f"   {len(images)} images generated.")
        print(f"   {len(detections)} detections generated.")
        print(f"   {len(classifications)} classifications generated.")

        # Curate first page: all 14 species, no consecutive duplicates
        print("   Curating first page (24 images, all species)...")
        curate_first_page(images, detections, classifications, species_image_info, rng)

        health_reports = generate_health_reports(cameras, rng)
        print(f"   {len(health_reports)} health reports generated.")

        deployment_periods = generate_deployment_periods(cameras)
        print(f"   {len(deployment_periods)} deployment periods generated.")

        # Step 6: Insert cameras
        print("[6/9] Inserting cameras...")
        cam_index_to_id = insert_cameras(session, cameras, project_id)
        print(f"   {len(cam_index_to_id)} cameras inserted.")

        # Step 7: Insert images, detections, classifications
        print("[7/9] Inserting images, detections, classifications...")
        print(f"   Inserting {len(images)} images...")
        image_uuid_to_id = insert_images_batch(session, images, cam_index_to_id)
        print(f"   Inserting {len(detections)} detections...")
        old_to_new_det = insert_detections_batch(session, detections, image_uuid_to_id, images)
        print(f"   Inserting {len(classifications)} classifications...")
        insert_classifications_batch(session, classifications, old_to_new_det)

        # Step 8: Health reports and deployment periods
        print("[8/9] Inserting health reports and deployment periods...")
        insert_health_reports_batch(session, health_reports, cam_index_to_id)
        insert_deployment_periods(session, deployment_periods, cam_index_to_id)

        # Update camera fields from generated data (including config JSON)
        print("   Updating camera latest fields and config...")
        update_camera_latest_fields(session, cam_index_to_id, cameras)

        # Step 9: Telegram config and notification preferences
        print("[9/9] Setting up Telegram and notification preferences...")
        insert_telegram_config(session)
        insert_notification_preferences(session, project_id, user_ids)
        print("   Telegram configured, 4 users with notification preferences.")

        # Commit everything
        print("   Committing...")
        session.commit()

    print()
    print("=" * 60)
    print("  Demo data population complete!")
    print("=" * 60)
    print()
    print(f"  Project: {PROJECT_NAME}")
    print(f"  Date range: {DATE_START} to {DATE_END}")
    print(f"  Cameras: {len(cameras)}")
    print(f"  Users: {len(DEMO_USERS)}")
    print(f"  Images:  {len(images)}")
    print(f"  Detections: {len(detections)}")
    print(f"  Classifications: {len(classifications)}")
    print(f"  Health reports: {len(health_reports)}")
    print(f"  Deployment periods: {len(deployment_periods)}")
    total = (
        1 + len(DEMO_USERS) + 1 + len(cameras) + len(images) + len(detections)
        + len(classifications) + len(health_reports) + len(deployment_periods)
    )
    print(f"  Total DB rows: ~{total:,}")
    print()
    print(f"  Login: demo@email.com / demo (project-admin)")
    print()


if __name__ == "__main__":
    main()
