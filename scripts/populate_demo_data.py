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
import gc
import io
import json
import math
import os
import sys
import urllib.request
import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from random import Random

# Add shared module to path
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "api"))

from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from shared.config import get_settings
from shared.geo import calculate_gps_distance
from shared.storage import (
    BUCKET_PROJECT_DOCUMENTS, BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS, StorageClient,
)

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

# Target number of cameras. An odd, non-round count reads less like fake data.
NUM_CAMERAS_TARGET = 103

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

# Demo users. The login account and the server admin keep fixed addresses; all
# the data-only accounts get an obviously fake john.doe / jane.doe local part
# per domain, iterating (john.doe2, jane.doe2, ...) so nobody mistakes them for
# real people. Passwords are random unless specified.
_FIXED_USERS = [
    {"email": "demo@email.com",           "is_superuser": False, "is_verified": True, "is_active": True, "role": "project-admin", "password": "xK9#mW2$vQ7!bN4p"},
    {"email": "admin@demo.addaxai.com",   "is_superuser": True,  "is_verified": True, "is_active": True, "role": "server-admin"},
]

# (domain, is_verified, is_active, role) for the data-only accounts.
_DEMO_USER_SPECS = [
    ("hogeveluwe.nl", True,  True,  "project-admin"),
    ("hogeveluwe.nl", True,  True,  "project-admin"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("hogeveluwe.nl", True,  True,  "project-viewer"),
    ("uu.nl",         True,  True,  "project-viewer"),
    ("wur.nl",        True,  True,  "project-viewer"),
    ("sovon.nl",      True,  True,  "project-viewer"),
    ("gmail.com",     False, True,  "project-viewer"),
    ("outlook.com",   False, True,  "project-viewer"),
    ("hogeveluwe.nl", True,  False, "project-viewer"),
    ("hogeveluwe.nl", True,  False, "project-viewer"),
]


def _build_demo_users() -> list:
    users = [dict(u) for u in _FIXED_USERS]
    per_domain: dict = {}
    for domain, verified, active, role in _DEMO_USER_SPECS:
        n = per_domain.get(domain, 0)
        per_domain[domain] = n + 1
        base = "john.doe" if n % 2 == 0 else "jane.doe"
        suffix = (n // 2) + 1
        local = base if suffix == 1 else f"{base}{suffix}"
        users.append({
            "email": f"{local}@{domain}",
            "is_superuser": False,
            "is_verified": verified,
            "is_active": active,
            "role": role,
        })
    return users


DEMO_USERS = _build_demo_users()

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

# The park sits in the Netherlands. Camera clocks are wall-clock local, stored
# naive and interpreted under ServerSettings.timezone (see DEVELOPERS.md). The
# demo sets this timezone so captured_at reads correctly everywhere.
SERVER_TIMEZONE = "Europe/Amsterdam"

# ---------------------------------------------------------------------------
# Site, deployment and curation showcase constants
# ---------------------------------------------------------------------------

# Real and plausible place names in and around De Hoge Veluwe. The pool is
# larger than the number of sites so every site gets a name and none falls
# back to coordinates.
SITE_NAME_POOL = [
    "Deelense Veld", "Oud-Reemsterveld", "Kemperberg", "Otterlose Bos",
    "Franse Berg", "Pampel", "Wildbaan", "Compagnieberg", "Hertenkamp",
    "Reemsterzand", "Deelerwoud", "Planken Wambuis", "Mossel", "Pollenberg",
    "Aardhuis", "Hoog Buurlo", "Wekeromse Zand", "Harskamp", "Kreelse Plas",
    "Zandverstuiving", "Koningsweg", "Schaarsbergen", "Rijzenburg", "De Pampel",
    "Hoenderloo", "Schaapskooi", "Jachthuis", "Bunkermuseum", "Houtkampweg",
    "Groevenbeek", "Stille Zandweg", "Vossenheuvel", "Reeënkamp", "Beukenlaan",
    "Heideveld", "Drift", "Boswachterspad", "Galgenberg", "Wildkansel",
    "Eperweg", "Kompagnieweg", "Doornberg", "Bedafse Berg", "Mosselse Veld",
    "Deelense Zand", "Reemsterheide", "Otterlose Heide", "Kempervennen",
    "Hoge Veld", "Lage Veld", "Oude Postweg", "Nieuwe Plijmen", "Plijmenweg",
    "Hoenderloseweg", "Woldhuis", "Vijverberg", "Zilvervennen", "Goudsberg",
    "Roekelse Bos", "Sysselt", "Ginkelse Heide", "Edese Bos", "Wolfheze",
    "Doorwerthse Bos", "Hartense Molen", "Quadenoord", "Kievitsdel", "Heveadorp",
    "Renkums Beekdal", "Oranje Nassau", "Schaapsdrift", "Imbosch", "Terlet",
    "Veluwezoom", "Posbank", "Herikhuizerveld", "Onzalige Bossen", "Carolinaberg",
    "Rozendaalse Veld", "Beekhuizen", "Worth-Rheden", "Heuven", "Middachten",
    "Elsbroek", "Speulderbos", "Sprielderbos", "Garderense Veld", "Putterheide",
    "Hulshorsterzand", "Leuvenumse Bos", "Ermelose Heide", "Stakenberg", "Elspeet",
    "Vierhouterbos", "Gortelse Bos", "Niersen", "Tongeren", "Wisselse Veen",
    "Epese Bos", "Tonnenberg", "Wenum", "Beekbergerwoud", "Loenermark",
    "Hoog Soeren", "Assel", "Echoput", "Aardmansberg", "Hoog Buurloseweg",
    "Caitwickerzand", "Stroese Zand", "Drieseberg", "Meervelderbos", "Uddelermeer",
    "Solse Gat", "Het Hol", "Bleek Meer", "Gerritsfles", "Kootwijkerzand",
    "Radioweg", "Harskampse Zand", "Otterloseweg", "Deelenseweg", "Kreelseweg",
]

# Habitat per spatial zone, picked when a site is created (Camtrap-DP "habitat").
ZONE_HABITAT = {
    "north": "Forest",
    "south_east": "Mixed woodland",
    "central_west": "Heathland",
    "edges": "Forest edge",
    "everywhere": "Sand drift",
}

# Layout knobs.
P_MULTI_CAMERA_SITE = 0.18   # share of sites that host 2-3 cameras
P_CAMERA_RELOCATED = 0.10    # share of deployed cameras that moved once

# Human observation vocabularies, kept in sync with the verification panel
# (services/frontend/src/components/VerificationPanel.tsx).
SEX_OPTIONS = ["unknown", "male", "female"]
LIFE_STAGE_OPTIONS = ["unknown", "adult", "subadult", "juvenile"]
BEHAVIOR_OPTIONS = [
    "unknown", "traveling", "foraging", "resting", "vigilance",
    "drinking", "grooming", "courtship", "nursing", "aggression", "marking",
]

# Species that move in groups, so observations record more than one animal.
HERD_DEER = {"roe_deer", "red_deer", "fallow_deer", "mouflon"}

# Share of animal images that get a human observation, a verification, a like,
# or a needs-review flag. Kept low so the demo looks worked-on, not fabricated.
OBSERVATION_RATE = 0.05
VERIFIED_RATE = 0.08
LIKED_RATE = 0.025
NEEDS_REVIEW_RATE = 0.02

# Rejection reasons the Live feed and ingestion monitoring know about (see
# services/ingestion/main.py). Weighted toward the everyday setup mistakes.
REJECTION_REASONS = [
    ("missing_gps", "Image has no GPS fix yet (camera sent before first lock)."),
    ("missing_datetime", "EXIF has no DateTimeOriginal, cannot place on the timeline."),
    ("no_camera_exif", "File has no camera EXIF (Make/Model missing)."),
    ("unsupported_camera", "No camera profile matches this make/model."),
    ("missing_device_id", "EXIF carries no serial number to match a camera."),
    ("invalid_gps", "GPS reads (0, 0), dropped before the missing-GPS check."),
    ("file_size", "File is smaller than the minimum valid image size."),
    ("mime_type", "Upload is not a recognised image MIME type."),
]

# One finished bulk upload (SD-card import) to showcase the bulk pipeline.
BULK_UPLOAD_FILENAME = "SD-card-Deelense-Veld-2024.zip"
BULK_UPLOAD_IMAGE_COUNT = 280
BULK_UPLOAD_DUPLICATES = 22
BULK_UPLOAD_OTHER_SKIPPED = 6

# Project reminder digests created by an admin.
DEMO_REMINDERS = [
    {"in_days": 6,   "message": "Swap SD cards and check batteries on the Deelense Veld cluster."},
    {"in_days": 19,  "message": "Quarterly export for the province biodiversity report."},
    {"in_days": -12, "message": "Replace the SIM that expired on the Kemperberg camera."},  # already sent
]

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def pick_demographics(species: str, season: str, rng: Random):
    """Return (sex, life_stage, behavior, count) for a human observation.

    Rough field priors: deer and boar move in groups and drop young in spring
    and summer; small mammals and birds are usually logged as single unknown
    adults. Used only to make the demographic charts look believable.
    """
    if species == "wild_boar":
        count = rng.choices([1, 2, 3, 4, 6], weights=[3, 3, 2, 2, 1])[0]
    elif species in HERD_DEER:
        count = rng.choices([1, 2, 3], weights=[6, 3, 1])[0]
    else:
        count = 1

    if species in ("bird", "squirrel", "hedgehog", "lagomorph", "mustelid", "fox", "cat"):
        sex = rng.choices(["unknown", "male", "female"], weights=[6, 2, 2])[0]
    else:
        sex = rng.choices(["unknown", "male", "female"], weights=[2, 4, 4])[0]

    young_weight = 3 if season in ("spring", "summer") else 1
    life_stage = rng.choices(
        ["adult", "subadult", "juvenile", "unknown"],
        weights=[6, 2, young_weight, 1],
    )[0]

    nursing_weight = 2 if (life_stage == "juvenile" and species in HERD_DEER | {"wild_boar"}) else 0
    behavior = rng.choices(
        ["foraging", "traveling", "vigilance", "resting", "grooming",
         "drinking", "marking", "nursing"],
        weights=[6, 5, 3, 2, 1, 1, 1, nursing_weight],
    )[0]
    return sex, life_stage, behavior, count

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


def make_text_pdf_bytes(title: str, lines: list) -> bytes:
    """Render a simple one-page A4 PDF with a title and text lines via Pillow.

    Pillow writes a real, valid PDF (an image-backed page), which avoids
    hand-rolling PDF structure and works without extra dependencies.
    """
    from PIL import Image as PILImage, ImageDraw

    width, height = 1240, 1754  # A4 at ~150 DPI
    img = PILImage.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)
    y = 120
    draw.text((100, y), title, fill="black")
    y += 70
    for line in lines:
        draw.text((100, y), line, fill="black")
        y += 38
    buf = io.BytesIO()
    img.save(buf, format="PDF", resolution=150.0)
    return buf.getvalue()


def demo_documents() -> list:
    """Build the example project documents (filename, content_type, description,
    bytes). Showcases the project documents feature with a mix of file types."""
    field_protocol = (
        "De Hoge Veluwe - camera trap field protocol\n"
        "===========================================\n\n"
        "1. Mount the camera at 80-100 cm, angled slightly down.\n"
        "2. Clear branches and tall grass from the field of view.\n"
        "3. Note the site name and compass position on the housing.\n"
        "4. Check the SIM and battery, confirm a test image arrives.\n"
        "5. Log the deployment date in the web interface.\n\n"
        "Maintenance every 6 weeks, sooner if the battery alert fires.\n"
    )
    camera_settings = (
        "# Willfine 4.0CG reference settings\n"
        "mode = photo\n"
        "photo_burst = 3\n"
        "interval_seconds = 5\n"
        "sensitivity = high\n"
        "night_mode = balanced\n"
        "daily_report = 08:00\n"
        "ftp_upload = enabled\n"
        "timezone = Europe/Amsterdam\n"
    )
    species_csv = "common_name,scientific_name,protected\n" + "\n".join(
        f"{name.replace('_', ' ')},,{'yes' if name in ('wolf', 'otter', 'lynx') else 'no'}"
        for name in ALL_SPECIES
    ) + "\n"

    permit_pdf = make_text_pdf_bytes(
        "Research permit - De Hoge Veluwe National Park",
        [
            "Permit number: HV-2024-0417 (demo)",
            "Holder: De Hoge Veluwe monitoring programme",
            "Scope: non-invasive camera trap monitoring of mammals.",
            "Valid: 1 January 2024 to 31 December 2026.",
            "Conditions: no baiting, blur people, share yearly summary.",
            "",
            "This is an example document for the demo dataset.",
        ],
    )
    monitoring_pdf = make_text_pdf_bytes(
        "Monitoring plan 2024-2026",
        [
            "Goal: track large mammals and mesocarnivores across the park.",
            "Cameras: ~100, on a grid across forest, heath and sand drift.",
            "Reporting: monthly battery digest, yearly biodiversity report.",
            "Species of interest: wolf, wild boar, red deer, pine marten.",
            "",
            "This is an example document for the demo dataset.",
        ],
    )
    return [
        ("field-protocol.txt", "text/plain", "Field protocol for deploying and maintaining cameras", field_protocol.encode()),
        ("camera-settings.txt", "text/plain", "Reference settings for the Willfine 4.0CG", camera_settings.encode()),
        ("species-list.csv", "text/csv", "Target species list for the project", species_csv.encode()),
        ("research-permit.pdf", "application/pdf", "Research permit for camera trap monitoring", permit_pdf),
        ("monitoring-plan.pdf", "application/pdf", "Monitoring plan 2024-2026", monitoring_pdf),
    ]


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

def _habitat_for_zones(zones: set, rng: Random) -> str:
    """Pick a habitat label from a position's spatial zones."""
    specific = [z for z in zones if z != "everywhere"]
    zone = rng.choice(specific) if specific else "everywhere"
    return ZONE_HABITAT[zone]


def _next_site_name(name_pool: list):
    """Pop the next reserved place name, or None to fall back to coordinates."""
    return name_pool.pop() if name_pool else None


def _date_in_gaps(d: date, gaps: list) -> bool:
    """True if date d falls inside any (start, end) offline range."""
    return any(gs <= d <= ge for gs, ge in gaps)


def assign_camera_gaps(cameras: list, rng: Random) -> None:
    """Give about half the deployed cameras one or more offline periods, so the
    activity timeline shows realistic gaps: some of a few months, some a few
    weeks, some a few days. No images and no health reports land during a gap.
    Stored on each camera as `gaps`, a list of (start_date, end_date)."""
    for cam in cameras:
        cam["gaps"] = []
    deployed = [c for c in cameras if not c["never_deployed"]]
    span = NUM_DAYS
    for cam in deployed:
        roll = rng.random()
        offsets = []  # (start_offset_days, length_days)
        if roll < 0.12:
            offsets.append((rng.randint(int(span * 0.2), int(span * 0.7)), rng.randint(60, 110)))
        elif roll < 0.30:
            offsets.append((rng.randint(int(span * 0.1), int(span * 0.85)), rng.randint(14, 35)))
        elif roll < 0.55:
            for _ in range(rng.choice([1, 2])):
                offsets.append((rng.randint(0, span - 12), rng.randint(3, 9)))
        for start_off, length in offsets:
            gs = DATE_START + timedelta(days=start_off)
            ge = min(gs + timedelta(days=length - 1), DATE_END)
            cam["gaps"].append((gs, ge))


def assign_camera_showcase_fields(cameras: list, rng: Random) -> None:
    """Fill SIM expiry, reference-image species, custom fields and notes.

    Spreads SIM dates so one camera is already expired and two expire within
    two weeks (drives the SIM-expiry alert), and tags a handful of cameras with
    a reference photo and free-form custom fields.
    """
    deployed = [c for c in cameras if not c["never_deployed"]]

    # SIM expiry: most far out, a few null, one expired, two expiring soon.
    for cam in cameras:
        roll = rng.random()
        if roll < 0.12:
            cam["sim_expiry_date"] = None
        else:
            cam["sim_expiry_date"] = DATE_END + timedelta(days=rng.randint(40, 700))
    if deployed:
        deployed[3]["sim_expiry_date"] = DATE_END - timedelta(days=4)        # expired
        deployed[7]["sim_expiry_date"] = DATE_END + timedelta(days=6)         # expiring soon
        deployed[11]["sim_expiry_date"] = DATE_END + timedelta(days=12)       # expiring soon

    # Reference images on a handful of deployed cameras (resolved to a real
    # MinIO path at insert time from species_image_info).
    ref_species = ["roe_deer", "red_deer", "fox", "wild_boar", "fallow_deer",
                   "mouflon", "bird", "mustelid"]
    for cam in cameras:
        cam["reference_species"] = None
    for cam, sp in zip(rng.sample(deployed, min(len(ref_species), len(deployed))), ref_species):
        cam["reference_species"] = sp

    # Custom fields, hardware revision, tags and notes on a subset.
    mounts = ["tree", "post", "pole", "rock"]
    housings = ["v1 housing", "v2 housing", "steel box"]
    for cam in cameras:
        cam["hardware_revision"] = rng.choice(["Rev A", "Rev B", "Rev C"])
        cam["custom_fields"] = None
        cam["tags"] = None
        cam["notes"] = None
    for cam in rng.sample(deployed, max(1, len(deployed) // 3)):
        cam["custom_fields"] = {
            "mount": rng.choice(mounts),
            "housing": rng.choice(housings),
        }
    for cam in rng.sample(deployed, max(1, len(deployed) // 6)):
        cam["tags"] = rng.choice([["solar"], ["priority"], ["solar", "priority"], ["wolf-watch"]])
    for cam in rng.sample(deployed, 4):
        cam["notes"] = rng.choice([
            "Lens fogs up on cold mornings, clean during maintenance.",
            "Mounted low for boar, expect many empty triggers from grass.",
            "Shared view with the neighbouring unit, watch for double counts.",
            "Solar panel angled south, battery holds well through winter.",
        ])


def generate_layout(rng: Random):
    """Build sites, cameras and deployments inside the park boundary.

    Most sites hold one camera; about a fifth hold two or three that share a
    view and are told apart by device_id. About a tenth of deployed
    cameras moved once, so they carry a second deployment at a fresh site. One
    camera stays in inventory and is never deployed.

    Returns (sites, cameras, deployments). Deployments reference cameras by
    `camera_index` and sites by `site_key`, and carry their own `key` that
    images link to.
    """
    # Candidate anchor points evenly spread inside the polygon.
    grid_density = 16
    candidates = []
    lat_step = (LAT_MAX - LAT_MIN) / (grid_density - 1)
    lon_step = (LON_MAX - LON_MIN) / (grid_density - 1)
    # At latitude ~52°N: 1° lat ≈ 111km, 1° lon ≈ 68km.
    for row in range(grid_density):
        for col in range(grid_density):
            lat = LAT_MIN + row * lat_step + rng.uniform(-0.0009, 0.0009)
            lon = LON_MIN + col * lon_step + rng.uniform(-0.00147, 0.00147)
            if point_in_polygon(lon, lat, PARK_BOUNDARY):
                candidates.append((round(lat, 6), round(lon, 6)))
    rng.shuffle(candidates)

    name_pool = list(SITE_NAME_POOL)
    rng.shuffle(name_pool)

    sites: list = []
    cameras: list = []
    deployments: list = []
    cam_index = 0
    dep_key = 1
    anchor_i = 0

    # The last camera (target - 1) stays in inventory, so deploy up to that.
    deploy_target = NUM_CAMERAS_TARGET - 1

    while cam_index < deploy_target and anchor_i < len(candidates):
        lat, lon = candidates[anchor_i]
        anchor_i += 1
        zones = camera_zone(lat, lon)
        site_key = len(sites)

        remaining = deploy_target - cam_index
        if remaining >= 2 and rng.random() < P_MULTI_CAMERA_SITE:
            n_here = min(rng.choice([2, 3]), remaining)
        else:
            n_here = 1

        sites.append({
            "key": site_key,
            "name": _next_site_name(name_pool),     # None -> coordinates at insert
            "habitat": _habitat_for_zones(zones, rng),
            "lat": lat,
            "lon": lon,
        })

        for k in range(n_here):
            if n_here > 1:
                clat = round(lat + rng.uniform(-0.0003, 0.0003), 6)
                clon = round(lon + rng.uniform(-0.0005, 0.0005), 6)
            else:
                clat, clon = lat, lon
            czones = camera_zone(clat, clon)
            cameras.append({
                "index": cam_index,
                "device_id": f"DHV{cam_index + 1:03d}",
                "never_deployed": False,
                "current_lat": clat,
                "current_lon": clon,
            })
            deployments.append({
                "key": dep_key,
                "camera_index": cam_index,
                "deployment_number": 1,
                "site_key": site_key,
                "lat": clat,
                "lon": clon,
                "zones": czones,
                "start_date": DATE_START,
                "end_date": None,
                # Multi-camera sites are human-confirmed (a person split them by
                # position); single-camera sites are GPS-guessed.
                "site_source": "manual" if n_here > 1 else "auto",
            })
            dep_key += 1
            cam_index += 1
            if cam_index >= deploy_target:
                break

    # Relocate a tenth of deployed cameras: close deployment 1 mid-timeline and
    # open deployment 2 at a fresh single-camera site.
    deployed = [c for c in cameras if not c["never_deployed"]]
    n_movers = max(1, int(len(deployed) * P_CAMERA_RELOCATED))
    for cam in rng.sample(deployed, n_movers):
        dep1 = next(
            d for d in deployments
            if d["camera_index"] == cam["index"] and d["deployment_number"] == 1
        )
        reloc_date = DATE_START + timedelta(days=rng.randint(int(NUM_DAYS * 0.35), int(NUM_DAYS * 0.70)))
        dep1["end_date"] = reloc_date - timedelta(days=1)

        if anchor_i < len(candidates):
            nlat, nlon = candidates[anchor_i]
            anchor_i += 1
        else:
            nlat = round(rng.uniform(LAT_MIN, LAT_MAX), 6)
            nlon = round(rng.uniform(LON_MIN, LON_MAX), 6)
        nzones = camera_zone(nlat, nlon)
        site2_key = len(sites)
        sites.append({
            "key": site2_key,
            "name": _next_site_name(name_pool),
            "habitat": _habitat_for_zones(nzones, rng),
            "lat": nlat,
            "lon": nlon,
        })
        deployments.append({
            "key": dep_key,
            "camera_index": cam["index"],
            "deployment_number": 2,
            "site_key": site2_key,
            "lat": nlat,
            "lon": nlon,
            "zones": nzones,
            "start_date": reloc_date,
            "end_date": None,
            "site_source": "auto",
        })
        cam["current_lat"] = nlat
        cam["current_lon"] = nlon
        dep_key += 1

    # Inventory-only camera: no site, no deployment, no health reports.
    cameras.append({
        "index": cam_index,
        "device_id": f"DHV{cam_index + 1:03d}",
        "never_deployed": True,
        "current_lat": None,
        "current_lon": None,
    })

    assign_camera_showcase_fields(cameras, rng)
    assign_camera_gaps(cameras, rng)
    return sites, cameras, deployments


def _day_image_count(zones: set, season: str, rng: Random) -> int:
    """Poisson draw for the number of images a deployment produces in a day."""
    rate = IMAGES_PER_CAMERA_PER_DAY
    if season == "winter":
        rate *= WINTER_GLOBAL_MULTIPLIER
    if "north" in zones:
        rate *= 1.8
    elif "south_east" in zones:
        rate *= 1.5
    elif "edges" in zones:
        rate *= 0.6
    return rng.choices(
        range(6),  # 0 to 5
        weights=[math.exp(-rate) * (rate ** k) / math.factorial(k) for k in range(6)],
        k=1,
    )[0]


def _emit_one_image(out, counters, *, device_id, camera_index, dep_key, lat, lon,
                    zones, current_date, species_image_info, rng,
                    origin="live", bulk_job_uuid=None):
    """Create one image plus its detection/classification and append the records
    to the `out` lists. Shared by the live and bulk-upload generators.

    captured_at is naive local (no tzinfo); it is interpreted under
    ServerSettings.timezone. ingested_at is derived from it at insert time.
    """
    season = get_season(current_date)

    roll = rng.random()
    if roll < DETECTION_RATES["animal"]:
        category = "animal"
    elif roll < DETECTION_RATES["animal"] + DETECTION_RATES["person"]:
        category = "person"
    elif roll < DETECTION_RATES["animal"] + DETECTION_RATES["person"] + DETECTION_RATES["vehicle"]:
        category = "vehicle"
    else:
        category = None  # empty image

    species = None
    if category == "animal":
        weights = []
        for sp, cfg in SPECIES_CONFIG.items():
            w = cfg["weight"] * zone_weight(cfg["zone"], zones)
            sp_seasons = SEASON_MULTIPLIERS.get(sp, {})
            if season in sp_seasons:
                w *= sp_seasons[season]
            weights.append(w)
        species = rng.choices(ALL_SPECIES, weights=weights, k=1)[0]
        species_activity = SPECIES_CONFIG[species]["activity"]
    elif category in ("person", "vehicle"):
        species_activity = "day_visitor"
    else:
        species_activity = "diurnal"

    hour = sample_hour(species_activity, rng)
    capture_dt = datetime(
        current_date.year, current_date.month, current_date.day,
        hour, rng.randint(0, 59), rng.randint(0, 59),
    )  # naive local

    img_uuid = str(uuid.UUID(int=rng.getrandbits(128), version=4))

    sp_info = species_image_info.get(species) if (category == "animal" and species) else None
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

    metadata = {
        "width": img_w,
        "height": img_h,
        "gps_decimal": [lat, lon],
        "DateTimeOriginal": capture_dt.strftime("%Y:%m:%d %H:%M:%S"),
        "Make": CAMERA_MAKE,
        "Model": CAMERA_MODEL,
        "SerialNumber": device_id,
    }

    image_id = counters["image"]
    image_rec = {
        "id": image_id,
        "uuid": img_uuid,
        "filename": f"IMG_{counters['img']:06d}.JPG",
        "camera_index": camera_index,
        "deployment_key": dep_key,
        "captured_at": capture_dt,
        "storage_path": img_storage_path,
        "thumbnail_path": img_thumb_path,
        "status": "classified",
        "image_metadata": json.dumps(metadata),
        "origin": origin,
        "bulk_job_uuid": bulk_job_uuid,
        # AI result kept for downstream generators (observations, curation); not inserted directly.
        "ai_species": species,
        "ai_category": category,
        # Curation, filled in later by generate_curation_and_observations.
        "is_verified": False, "verified_at": None, "verified_by": None, "verification_notes": None,
        "is_liked": False, "liked_at": None, "liked_by": None,
        "needs_review": False, "needs_review_at": None, "needs_review_by": None,
    }
    out["images"].append(image_rec)
    counters["image"] += 1
    counters["img"] += 1

    if category is None:
        return

    det_confidence = round(rng.uniform(0.3, 0.985), 4)
    if sp_info is not None:
        x_norm, y_norm, w_frac, h_frac = sp_info["bbox"]
    else:
        if category == "animal":
            w_frac = rng.uniform(0.15, 0.40)
            h_frac = rng.uniform(0.15, 0.40)
        elif category == "person":
            w_frac = rng.uniform(0.10, 0.25)
            h_frac = rng.uniform(0.30, 0.60)
        else:  # vehicle
            w_frac = rng.uniform(0.20, 0.50)
            h_frac = rng.uniform(0.15, 0.30)
        x_norm = rng.uniform(0.0, max(1.0 - w_frac, 0.01))
        y_norm = rng.uniform(0.0, max(1.0 - h_frac, 0.01))

    bbox = {
        "x_min": int(x_norm * img_w),
        "y_min": int(y_norm * img_h),
        "width": int(w_frac * img_w),
        "height": int(h_frac * img_h),
        "normalized": [round(x_norm, 4), round(y_norm, 4), round(w_frac, 4), round(h_frac, 4)],
    }

    detection_id = counters["detection"]
    out["detections"].append({
        "id": detection_id,
        "image_id": image_id,
        "category": category,
        "confidence": det_confidence,
        "bbox": json.dumps(bbox),
    })
    counters["detection"] += 1

    if category == "animal" and species:
        conf_lo, conf_hi = CONFIDENCE_RANGES.get(species, (0.55, 0.90))
        cls_confidence = round(rng.uniform(conf_lo, conf_hi), 4)
        out["classifications"].append({
            "id": counters["classification"],
            "detection_id": detection_id,
            "species": species,
            "confidence": cls_confidence,
        })
        counters["classification"] += 1


def generate_all_data(deployments: list, cameras: list, rng: Random, species_image_info: dict):
    """Generate live images, detections and classifications, one deployment at a
    time over the deployment's active date range.

    Returns (images, detections, classifications, counters). The counters dict
    is threaded into generate_bulk_data so the bulk import keeps unique ids.
    """
    out = {"images": [], "detections": [], "classifications": []}
    counters = {"image": 1, "detection": 1, "classification": 1, "img": 1}
    device_by_index = {c["index"]: c["device_id"] for c in cameras}
    gaps_by_index = {c["index"]: c.get("gaps", []) for c in cameras}

    for dep in deployments:
        device_id = device_by_index[dep["camera_index"]]
        gaps = gaps_by_index[dep["camera_index"]]
        end = dep["end_date"] or DATE_END
        n_days = (end - dep["start_date"]).days + 1
        for day_offset in range(n_days):
            current_date = dep["start_date"] + timedelta(days=day_offset)
            if _date_in_gaps(current_date, gaps):
                continue  # camera offline: no images this day
            season = get_season(current_date)
            for _ in range(_day_image_count(dep["zones"], season, rng)):
                _emit_one_image(
                    out, counters,
                    device_id=device_id, camera_index=dep["camera_index"],
                    dep_key=dep["key"], lat=dep["lat"], lon=dep["lon"],
                    zones=dep["zones"], current_date=current_date,
                    species_image_info=species_image_info, rng=rng,
                )

    return out["images"], out["detections"], out["classifications"], counters


def generate_bulk_data(deployments: list, cameras: list, rng: Random,
                       species_image_info: dict, counters: dict, job_uuid: str):
    """Generate the images for one finished bulk SD-card import.

    Emits BULK_UPLOAD_IMAGE_COUNT images for one active deployment across a
    six-week window, all origin='bulk' and linked to the job. Returns
    (images, detections, classifications, camera_index, window_start, window_end).
    """
    device_by_index = {c["index"]: c["device_id"] for c in cameras}
    active = [d for d in deployments if d["end_date"] is None]
    dep = rng.choice(active)
    device_id = device_by_index[dep["camera_index"]]

    window_end = DATE_END - timedelta(days=10)
    window_start = window_end - timedelta(days=42)
    span_days = (window_end - window_start).days + 1

    out = {"images": [], "detections": [], "classifications": []}
    for _ in range(BULK_UPLOAD_IMAGE_COUNT):
        current_date = window_start + timedelta(days=rng.randint(0, span_days - 1))
        _emit_one_image(
            out, counters,
            device_id=device_id, camera_index=dep["camera_index"],
            dep_key=dep["key"], lat=dep["lat"], lon=dep["lon"],
            zones=dep["zones"], current_date=current_date,
            species_image_info=species_image_info, rng=rng,
            origin="bulk", bulk_job_uuid=job_uuid,
        )

    return (out["images"], out["detections"], out["classifications"],
            dep["camera_index"], window_start, window_end)


def generate_health_reports(cameras: list, rng: Random) -> list:
    """Generate daily health reports for all cameras."""
    reports = []
    report_id = 1

    for cam in cameras:
        # Never-deployed cameras have no health reports at all
        if cam.get("never_deployed"):
            continue

        battery = rng.uniform(85, 90)
        sd_used = rng.uniform(2, 7)
        total_images = 0
        sent_images = 0
        # Per-camera signal baseline
        signal_base = rng.randint(12, 22)
        # Vary when cameras last reported (not all today)
        # Cameras 42 and 78: last report >7 days ago → frontend shows "inactive"
        if cam["index"] in (42, 78):
            days_short = rng.randint(10, 14)
        else:
            days_short = rng.choices([0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 5], k=1)[0]

        for day_offset in range(NUM_DAYS - days_short):
            current_date = DATE_START + timedelta(days=day_offset)
            if _date_in_gaps(current_date, cam["gaps"]):
                continue  # camera offline: no daily report
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

            # SD utilization: track "% used"
            # Target: 3-7% used, occasional card swap resets to near-zero
            daily_imgs = rng.randint(0, 3)
            total_images += daily_imgs
            sent_images += max(0, daily_imgs - rng.randint(0, 1))
            sd_used += daily_imgs * 0.003             # Each image uses ~0.3% of space
            if sd_used > 15 or rng.random() < 0.03:
                sd_used = rng.uniform(2, 7)           # Card swap → near-empty card
            sd_used = min(sd_used, 20.0)              # Cap at 20% used

            reports.append({
                "id": report_id,
                "camera_index": cam["index"],
                # Synthetic daily reports arrive at 08:00 local time.
                "reported_at": datetime.combine(current_date, time(8, 0)),
                "battery_percent": max(0, min(100, int(battery))),
                "signal_quality": signal,
                "temperature_c": int(round(temp)),
                "sd_utilization_percent": round(sd_used, 1),
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

    # Sort by captured_at desc and pick top candidates
    animal_images.sort(key=lambda x: x[0]["captured_at"], reverse=True)
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
    max_ts = max(img["captured_at"] for img in images)
    for i, ((img, det, cls), species) in enumerate(zip(selected, sequence)):
        # Index 0 = most recent on the page (highest timestamp)
        new_ts = max_ts + timedelta(minutes=FRONT_PAGE_SIZE - i)
        img["captured_at"] = new_ts

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


def _recent_utc(rng: Random, max_days_ago: int = 60) -> datetime:
    """An aware UTC timestamp somewhere within the last `max_days_ago` days."""
    return datetime.now(timezone.utc) - timedelta(
        days=rng.randint(0, max_days_ago),
        hours=rng.randint(0, 23),
        minutes=rng.randint(0, 59),
    )


# The rare disagreement between human and model is confined to deer telling
# apart, the classic real-world confusion. Pairs are swapped both ways between
# species of similar frequency, so the off-diagonal cells stay balanced and no
# rare class gets flooded. Every non-deer class then scores near-perfect, and
# the deer stay in the mid-90s, which reads as a trustworthy model.
SPECIES_CONFUSION = {
    "roe_deer": "red_deer", "red_deer": "roe_deer",
    "fallow_deer": "mouflon", "mouflon": "fallow_deer",
}

# How often the human label differs from the model (only for the species above).
# Tuned so the performance page lands around 93% top-1, which reads as a real
# model rather than a suspiciously perfect one. The disagreement sits on the
# deer, which genuinely look alike; distinctive species stay near-perfect.
CONFUSION_RATE = 0.12


def _confused_species(ai_sp: str, rng: Random) -> str:
    # Only the deer pairs are ever confused; everything else the human confirms.
    return SPECIES_CONFUSION.get(ai_sp, ai_sp)


def generate_curation_and_observations(images: list, detections: list,
                                       classifications: list, members: list,
                                       rng: Random) -> list:
    """Mark images verified / liked / needs-review and create human observations.

    Every verified image gets exactly one human observation whose species
    matches the model ~96% of the time, and its detection + classification
    confidence is raised above the project thresholds. This makes the
    performance page (verified images only) show a believable ~96% top-1
    accuracy and strong per-class F1, instead of comparing the model against
    images that have no human label. A sprinkle of observations on unverified
    images keeps the demographic and behaviour charts rich.

    Mutates the image / detection / classification dicts in place; returns the
    list of observation dicts. Call after the first page is curated.
    """
    animal = [im for im in images if im["ai_category"] == "animal" and im["ai_species"]]
    obs: list = []
    if not animal or not members:
        return obs

    det_by_image: dict = {}
    for d in detections:
        if d["category"] == "animal" and d["image_id"] not in det_by_image:
            det_by_image[d["image_id"]] = d
    cls_by_det = {c["detection_id"]: c for c in classifications}

    verify_notes = [
        "Confirmed, clear broadside view.",
        "Agree with the model.",
        "Reclassified after checking the antlers.",
        "Good capture, identification is certain.",
    ]

    def add_observation(im: dict, species: str, when) -> None:
        season = get_season(im["captured_at"].date())
        sex, life_stage, behavior, count = pick_demographics(species, season, rng)
        obs.append({
            "image_uuid": im["uuid"],
            "species": species,
            "count": count,
            "sex": sex,
            "life_stage": life_stage,
            "behavior": behavior,
            "created_by": rng.choice(members),
            "created_at": when,
        })

    verified_ids = set()
    for im in rng.sample(animal, max(1, int(len(animal) * VERIFIED_RATE))):
        verified_ids.add(id(im))
        im["is_verified"] = True
        im["verified_at"] = _recent_utc(rng)
        im["verified_by"] = rng.choice(members)
        if rng.random() < 0.25:
            im["verification_notes"] = rng.choice(verify_notes)

        # Make the detection unambiguously visible so the AI top-1 is the
        # species (not "empty" from a sub-threshold detection).
        ai_sp = im["ai_species"]
        det = det_by_image.get(im["id"])
        if det:
            det["confidence"] = round(rng.uniform(0.80, 0.985), 4)
            cls = cls_by_det.get(det["id"])
            if cls:
                cls["confidence"] = round(rng.uniform(0.88, 0.99), 4)
                ai_sp = cls["species"]

        species = ai_sp if rng.random() >= CONFUSION_RATE else _confused_species(ai_sp, rng)
        add_observation(im, species, im["verified_at"])

    # Force-like the most recent few so the first page shows favourites.
    by_recent = sorted(animal, key=lambda im: im["captured_at"], reverse=True)
    liked_ids = set()
    for im in by_recent[:6]:
        im["is_liked"] = True
        im["liked_at"] = _recent_utc(rng, 14)
        im["liked_by"] = rng.choice(members)
        liked_ids.add(id(im))
    for im in rng.sample(animal, max(1, int(len(animal) * LIKED_RATE))):
        if id(im) in liked_ids:
            continue
        im["is_liked"] = True
        im["liked_at"] = _recent_utc(rng)
        im["liked_by"] = rng.choice(members)

    for im in rng.sample(animal, max(1, int(len(animal) * NEEDS_REVIEW_RATE))):
        im["needs_review"] = True
        im["needs_review_at"] = _recent_utc(rng, 21)
        im["needs_review_by"] = rng.choice(members)

    # Extra observations on unverified images, for chart richness only (these
    # do not enter the performance matrix, which is verified images only).
    unverified = [im for im in animal if id(im) not in verified_ids]
    for im in rng.sample(unverified, max(1, int(len(unverified) * OBSERVATION_RATE))):
        ai_sp = im["ai_species"]
        species = ai_sp if rng.random() >= 0.10 else _confused_species(ai_sp, rng)
        add_observation(im, species, _recent_utc(rng))

    return obs


def build_bulk_job_record(job_uuid: str, camera_index: int, window_start: date,
                          window_end: date, n_images: int, created_by: int) -> dict:
    """Build the BulkUploadJob row for one finished SD-card import."""
    duplicates = BULK_UPLOAD_DUPLICATES
    other = BULK_UPLOAD_OTHER_SKIPPED
    total = n_images + duplicates + other

    finished = datetime.now(timezone.utc) - timedelta(days=9, hours=3)
    process_started = finished - timedelta(minutes=38)
    started = process_started - timedelta(minutes=4)
    created = started - timedelta(minutes=1)

    manifest = {
        "total_entries": total,
        "valid_count": n_images + duplicates,
        "by_status": {"valid": n_images + duplicates, "skipped_other": other},
        "date_range": {
            "start": datetime.combine(window_start, time(0, 0)).isoformat(),
            "end": datetime.combine(window_end, time(23, 59)).isoformat(),
        },
        "suggested_camera": None,
        "matched_cameras": [],
        "process_summary": {
            "queued_for_pipeline": n_images,
            "duplicates": duplicates,
            "other_skipped": other,
        },
        "file_log": [
            {"filename": "IMG_000001.JPG", "status": "queued"},
            {"filename": "IMG_000002.JPG", "status": "duplicate"},
            {"filename": "Thumbs.db", "status": "skipped_other"},
        ],
    }
    return {
        "uuid": job_uuid,
        "camera_index": camera_index,
        "created_by": created_by,
        "original_filename": BULK_UPLOAD_FILENAME,
        "staged_object_key": f"{job_uuid}/{BULK_UPLOAD_FILENAME}",
        "status": "done",
        "total_files": total,
        "processed_files": n_images,
        "skipped_files": duplicates + other,
        "manifest": json.dumps(manifest),
        "created_at": created,
        "started_at": started,
        "process_started_at": process_started,
        "finished_at": finished,
    }


def generate_rejections(cameras: list, rng: Random) -> list:
    """Rejected-file rows for the Live feed and ingestion monitoring.

    About a third come from an unregistered device (no camera match, no
    project, server-admin page only); the rest map to a real demo camera.
    """
    deployed = [c for c in cameras if not c["never_deployed"]]
    rejections = []
    for _ in range(16):
        reason, details = rng.choice(REJECTION_REASONS)
        if rng.random() < 0.30 or not deployed:
            device_id = f"UNREG-{rng.randint(1000, 9999)}"
            known = False
        else:
            device_id = rng.choice(deployed)["device_id"]
            known = True

        # Only the GPS reasons carry a usable capture time (naive local).
        if reason in ("missing_gps", "invalid_gps"):
            captured_at = (datetime.now() - timedelta(
                days=rng.randint(0, 12), hours=rng.randint(0, 23))).replace(microsecond=0)
        else:
            captured_at = None

        filename = "Test-Snapshot.jpeg" if reason == "missing_datetime" else f"IMG_{rng.randint(1, 9999):04d}.JPG"
        rejections.append({
            "filename": filename,
            "disk_path": f"/uploads/rejected/{reason}/{filename}",
            "reason": reason,
            "details": details,
            "device_id": device_id,
            "known_device": known,
            "captured_at": captured_at,
            "exif_metadata": json.dumps({"Make": CAMERA_MAKE, "Model": CAMERA_MODEL}) if known else None,
            "file_size_bytes": rng.randint(180_000, 3_500_000),
            "rejected_at": _recent_utc(rng, 12),
        })
    return rejections


def generate_reminders(admin_user_id: int) -> list:
    """Project reminder digests: two pending, one already sent."""
    reminders = []
    for r in DEMO_REMINDERS:
        send_on = DATE_END + timedelta(days=r["in_days"])
        sent_at = None
        if r["in_days"] < 0:
            sent_at = datetime.combine(send_on, time(6, 45)).replace(tzinfo=timezone.utc)
        reminders.append({
            "send_on": send_on,
            "message": r["message"],
            "created_by": admin_user_id,
            "sent_at": sent_at,
        })
    return reminders


# ---------------------------------------------------------------------------
# Database functions
# ---------------------------------------------------------------------------

def clean_demo_data(session: Session):
    """Delete existing demo data by project name (respecting FK order)."""
    # Users to delete: collected from the demo project's memberships (below) plus
    # the fixed accounts by email. Collecting members means a change to the email
    # scheme still removes the previous run's users instead of orphaning them.
    demo_user_ids: set = set()

    project_row = session.execute(
        text("SELECT id FROM projects WHERE name = :name"),
        {"name": PROJECT_NAME},
    ).fetchone()

    if project_row:
        project_id = project_row[0]
        print(f"   Found existing project id={project_id}, cleaning...")

        # Member user ids, before the memberships are deleted further down.
        demo_user_ids.update(
            r[0] for r in session.execute(
                text("SELECT user_id FROM project_memberships WHERE project_id = :pid"),
                {"pid": project_id},
            ).fetchall()
        )

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

            # Bulk jobs reference cameras with NO ACTION, so clear them first.
            session.execute(text("DELETE FROM bulk_upload_jobs WHERE project_id = :pid"), {"pid": project_id})

            # Delete camera-related data
            session.execute(text(f"DELETE FROM camera_health_reports WHERE camera_id IN ({cam_ids_str})"))
            session.execute(text(f"DELETE FROM deployments WHERE camera_id IN ({cam_ids_str})"))
            session.execute(text("DELETE FROM sites WHERE project_id = :pid"), {"pid": project_id})
            session.execute(text(f"DELETE FROM cameras WHERE id IN ({cam_ids_str})"))

        # Project-scoped feature rows, then access rows, then the project.
        session.execute(text("DELETE FROM rejections WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM project_reminders WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM project_notification_preferences WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM project_memberships WHERE project_id = :pid"), {"pid": project_id})
        session.execute(text("DELETE FROM projects WHERE id = :pid"), {"pid": project_id})
    else:
        print("   No existing demo project found.")

    # Delete telegram config (global, not per-project)
    session.execute(text("DELETE FROM telegram_config"))

    # Add the fixed accounts (e.g. the server admin, which has no membership) by
    # email, then delete every collected demo user. Tokens and notification
    # preferences cascade on the user delete.
    for user_info in DEMO_USERS:
        row = session.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": user_info["email"]},
        ).fetchone()
        if row:
            demo_user_ids.add(row[0])

    for uid in demo_user_ids:
        session.execute(
            text("DELETE FROM telegram_linking_tokens WHERE user_id = :uid"), {"uid": uid}
        )
        session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": uid})

    # Clean up legacy demo user from previous script version
    session.execute(text("DELETE FROM users WHERE email = 'viewer@demo.addaxai.com'"))

    # Safety sweep: drop any leftover non-admin user with no project membership.
    # These are demo accounts orphaned by an earlier run (e.g. an email-scheme
    # change). This is a demo-only reset script, so the sweep is safe and never
    # touches server admins.
    orphan_rows = session.execute(
        text(
            "SELECT id FROM users WHERE is_superuser = false "
            "AND id NOT IN (SELECT user_id FROM project_memberships)"
        )
    ).fetchall()
    for (uid,) in orphan_rows:
        session.execute(
            text("DELETE FROM telegram_linking_tokens WHERE user_id = :uid"), {"uid": uid}
        )
        session.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": uid})

    session.flush()
    print("   Cleanup complete.")


def insert_server_settings(session: Session) -> None:
    """Set the server timezone (single-row table), so camera-clock timestamps
    read correctly. SpeciesNet region is set too in case the demo runs that
    classifier. Upserts the single row."""
    session.execute(text("DELETE FROM server_settings"))
    session.execute(
        text("""
            INSERT INTO server_settings (
                timezone, speciesnet_country_code, speciesnet_admin1_region
            ) VALUES (:tz, :country, NULL)
        """),
        {"tz": SERVER_TIMEZONE, "country": "NLD"},
    )
    session.flush()


def insert_project(session: Session) -> int:
    """Create project with PostGIS polygon boundary from real park shape."""
    coords = ", ".join(f"{lon} {lat}" for lon, lat in PARK_BOUNDARY)
    boundary_wkt = f"POLYGON(({coords}))"
    # Per-species classification thresholds: a default plus a couple of
    # overrides, to showcase the threshold feature on the project settings page.
    classification_thresholds = {
        "default": 0.5,
        "overrides": {"wolf": 0.4, "lynx": 0.4, "bird": 0.6},
    }
    result = session.execute(
        text("""
            INSERT INTO projects (
                name, description, location, included_species,
                detection_threshold, classification_thresholds,
                blur_people_vehicles, independence_interval_minutes
            ) VALUES (
                :name, :description, ST_GeogFromText(:boundary),
                :species, :threshold, CAST(:cls_thresholds AS json),
                :blur, :independence
            ) RETURNING id
        """),
        {
            "name": PROJECT_NAME,
            "description": PROJECT_DESCRIPTION,
            "species": json.dumps(ALL_SPECIES),
            "boundary": boundary_wkt,
            "threshold": 0.5,
            "cls_thresholds": json.dumps(classification_thresholds),
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

    # Generate project thumbnail (512px max width, aspect-ratio preserving, 95% quality)
    from PIL import Image as PILImage

    img = PILImage.open(io.BytesIO(raw_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    max_width = 512
    new_width = min(max_width, img.width)
    new_height = int(new_width * (img.height / img.width))
    img = img.resize((new_width, new_height), PILImage.LANCZOS)
    thumb_buf = io.BytesIO()
    img.save(thumb_buf, format="JPEG", quality=95, optimize=True)
    with open(os.path.join(PROJECT_IMAGES_DIR, thumbnail_filename), "wb") as f:
        f.write(thumb_buf.getvalue())

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


def insert_sites(session: Session, sites: list, project_id: int) -> dict:
    """Insert sites. Returns {site_key: db_id}. Unnamed sites fall back to a
    coordinate string, which keeps the per-project name unique."""
    key_to_id = {}
    for site in sites:
        # Every site carries a real name from the pool; this fallback is only a
        # safety net and still avoids coordinate-style names.
        name = site["name"] or f"Perceel {site['key'] + 1}"
        result = session.execute(
            text("""
                INSERT INTO sites (uuid, project_id, name, location, habitat_type)
                VALUES (:uuid, :pid, :name, ST_GeogFromText(:loc), :habitat)
                RETURNING id
            """),
            {
                "uuid": str(uuid.uuid4()),
                "pid": project_id,
                "name": name,
                "loc": f"POINT({site['lon']} {site['lat']})",
                "habitat": site["habitat"],
            },
        )
        key_to_id[site["key"]] = result.fetchone()[0]
    session.flush()
    return key_to_id


def insert_cameras(session: Session, cameras: list, project_id: int,
                   species_image_info: dict) -> dict:
    """Insert cameras (device_id only, no name/location). Returns {camera_index: db_id}.

    Sets SIM expiry, reference image (resolved to a MinIO path), custom fields,
    tags and notes from the showcase fields on each camera dict.
    """
    index_to_id = {}
    installed = datetime(DATE_START.year, DATE_START.month, DATE_START.day, tzinfo=timezone.utc)
    for cam in cameras:
        ref_path = ref_thumb = None
        ref_species = cam.get("reference_species")
        if ref_species:
            info = species_image_info.get(ref_species)
            if info:
                ref_path = info["storage_path"]
                ref_thumb = info["thumbnail_path"]

        result = session.execute(
            text("""
                INSERT INTO cameras (
                    device_id, manufacturer, model, hardware_revision, project_id,
                    status, installed_at, sim_expiry_date,
                    reference_image_path, reference_thumbnail_path,
                    custom_fields, tags, notes
                ) VALUES (
                    :device_id, :make, :model, :hw, :pid,
                    :status, :installed, :sim_expiry,
                    :ref_path, :ref_thumb,
                    CAST(:custom_fields AS json), CAST(:tags AS json), :notes
                ) RETURNING id
            """),
            {
                "device_id": cam["device_id"],
                "make": CAMERA_MAKE,
                "model": CAMERA_MODEL,
                "hw": cam.get("hardware_revision"),
                "pid": project_id,
                "status": "inventory" if cam["never_deployed"] else "active",
                "installed": None if cam["never_deployed"] else installed,
                "sim_expiry": cam.get("sim_expiry_date"),
                "ref_path": ref_path,
                "ref_thumb": ref_thumb,
                "custom_fields": json.dumps(cam["custom_fields"]) if cam.get("custom_fields") else None,
                "tags": json.dumps(cam["tags"]) if cam.get("tags") else None,
                "notes": cam.get("notes"),
            },
        )
        index_to_id[cam["index"]] = result.fetchone()[0]
    session.flush()
    return index_to_id


def insert_images_batch(session: Session, images: list, cam_index_to_id: dict,
                        dep_key_to_id: dict, job_uuid_to_id: dict):
    """Batch insert images in chunks. Resolves deployment and bulk-job links,
    derives ingested_at from captured_at under the server timezone, and carries
    the curation columns. Returns {uuid: db_id}."""
    columns = (
        "uuid, filename, camera_id, captured_at, storage_path, thumbnail_path, "
        "status, image_metadata, origin, deployment_id, bulk_upload_job_id, "
        "ingested_at, is_hidden, is_verified, verified_at, verified_by_user_id, "
        "verification_notes, is_liked, liked_at, liked_by_user_id, "
        "needs_review, needs_review_at, needs_review_by_user_id"
    )
    chunk_size = 1000
    for i in range(0, len(images), chunk_size):
        chunk = images[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, img in enumerate(chunk):
            # Chunk-local bind names (not the absolute row index). Every full
            # chunk then compiles to the same SQL, so SQLAlchemy caches one
            # statement instead of one per chunk. Absolute indices made each
            # chunk a unique statement and bloated the compiled cache to ~3 GB.
            k = f"_{j}"
            values_parts.append(
                f"(:uuid{k}, :filename{k}, :camera_id{k}, :captured_at{k}, "
                f":storage_path{k}, :thumbnail_path{k}, :status{k}, "
                f"CAST(:metadata{k} AS jsonb), :origin{k}, :deployment_id{k}, "
                f":bulk_job_id{k}, "
                f"(CAST(:captured_at{k} AS timestamp) AT TIME ZONE '{SERVER_TIMEZONE}'), "
                f"false, :is_verified{k}, :verified_at{k}, :verified_by{k}, "
                f":verification_notes{k}, :is_liked{k}, :liked_at{k}, :liked_by{k}, "
                f":needs_review{k}, :needs_review_at{k}, :needs_review_by{k})"
            )
            bulk_uuid = img.get("bulk_job_uuid")
            params.update({
                f"uuid{k}": img["uuid"],
                f"filename{k}": img["filename"],
                f"camera_id{k}": cam_index_to_id[img["camera_index"]],
                f"captured_at{k}": img["captured_at"],
                f"storage_path{k}": img["storage_path"],
                f"thumbnail_path{k}": img["thumbnail_path"],
                f"status{k}": img["status"],
                f"metadata{k}": img["image_metadata"],
                f"origin{k}": img["origin"],
                f"deployment_id{k}": dep_key_to_id.get(img["deployment_key"]),
                f"bulk_job_id{k}": job_uuid_to_id.get(bulk_uuid) if bulk_uuid else None,
                f"is_verified{k}": img["is_verified"],
                f"verified_at{k}": img["verified_at"],
                f"verified_by{k}": img["verified_by"],
                f"verification_notes{k}": img["verification_notes"],
                f"is_liked{k}": img["is_liked"],
                f"liked_at{k}": img["liked_at"],
                f"liked_by{k}": img["liked_by"],
                f"needs_review{k}": img["needs_review"],
                f"needs_review_at{k}": img["needs_review_at"],
                f"needs_review_by{k}": img["needs_review_by"],
            })

        session.execute(
            text(f"INSERT INTO images ({columns}) VALUES " + ", ".join(values_parts)),
            params,
        )
        # Commit per chunk. The images table carries many indexes, so one big
        # transaction spikes Postgres memory and OOMs the small demo VM.
        session.commit()

    rows = session.execute(
        text("SELECT uuid, id FROM images WHERE storage_path LIKE 'demo/%'"),
    ).fetchall()
    return {r[0]: r[1] for r in rows}


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
            key = f"_{j}"
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

        session.commit()  # bound transaction size for the small demo VM

    return old_to_new_det


def insert_classifications_batch(session: Session, classifications: list, old_to_new_det: dict):
    """Batch insert classifications."""
    chunk_size = 2000
    for i in range(0, len(classifications), chunk_size):
        chunk = classifications[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, cls in enumerate(chunk):
            key = f"_{j}"
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
        session.commit()  # bound transaction size for the small demo VM


def insert_health_reports_batch(session: Session, reports: list, cam_index_to_id: dict):
    """Batch insert health reports."""
    chunk_size = 5000
    for i in range(0, len(reports), chunk_size):
        chunk = reports[i:i + chunk_size]
        values_parts = []
        params = {}
        for j, rep in enumerate(chunk):
            key = f"_{j}"
            values_parts.append(
                f"(:camera_id{key}, :reported_at{key}, :battery{key}, "
                f":signal{key}, :temp{key}, :sd{key}, :total{key}, :sent{key})"
            )
            params[f"camera_id{key}"] = cam_index_to_id[rep["camera_index"]]
            params[f"reported_at{key}"] = rep["reported_at"]
            params[f"battery{key}"] = rep["battery_percent"]
            params[f"signal{key}"] = rep["signal_quality"]
            params[f"temp{key}"] = rep["temperature_c"]
            params[f"sd{key}"] = rep["sd_utilization_percent"]
            params[f"total{key}"] = rep["total_images"]
            params[f"sent{key}"] = rep["sent_images"]

        sql = (
            "INSERT INTO camera_health_reports "
            "(camera_id, reported_at, battery_percent, signal_quality, "
            "temperature_c, sd_utilization_percent, total_images, sent_images) VALUES "
            + ", ".join(values_parts)
        )
        session.execute(text(sql), params)
        session.commit()  # bound transaction size for the small demo VM


def insert_deployments(session: Session, deployments: list, cam_index_to_id: dict,
                       site_key_to_id: dict) -> dict:
    """Insert deployments linked to their site, with the GPS-guessed vs
    human-confirmed source. Returns {deployment_key: db_id}."""
    key_to_id = {}
    for dep in deployments:
        result = session.execute(
            text("""
                INSERT INTO deployments (
                    camera_id, deployment_number, site_id, site_source,
                    start_date, end_date, location
                ) VALUES (
                    :camera_id, :num, :site_id, :site_source,
                    :start, :end, ST_GeogFromText(:loc)
                ) RETURNING id
            """),
            {
                "camera_id": cam_index_to_id[dep["camera_index"]],
                "num": dep["deployment_number"],
                "site_id": site_key_to_id[dep["site_key"]],
                "site_source": dep["site_source"],
                "start": dep["start_date"],
                "end": dep["end_date"],
                "loc": f"POINT({dep['lon']} {dep['lat']})",
            },
        )
        key_to_id[dep["key"]] = result.fetchone()[0]
    session.flush()
    return key_to_id


def insert_feed_events(session: Session, deployments: list, cam_index_to_id: dict,
                       site_key_to_id: dict, dep_key_to_id: dict, project_id: int) -> None:
    """Seed the camera updates feed, mirroring what live ingestion writes.

    One camera_first_seen per camera's first placement, resolved a day later
    as a rename (the demo sites carry real names, so someone named them). One
    camera_moved per relocation, left unresolved so the panel shows open
    entries. feed_seen is stamped 30 days before the newest event for every
    project member, so the sidebar badge shows the recent entries only.
    """
    first_by_camera = {
        dep["camera_index"]: dep for dep in deployments if dep["deployment_number"] == 1
    }
    for dep in deployments:
        created = datetime.combine(dep["start_date"], time(9, 12), tzinfo=timezone.utc)
        if dep["deployment_number"] == 1:
            event_type = "camera_first_seen"
            from_site_id = None
            distance_m = None
            resolved_action = "rename_site"
            resolved_at = created + timedelta(days=1)
        else:
            prev = first_by_camera[dep["camera_index"]]
            event_type = "camera_moved"
            from_site_id = site_key_to_id[prev["site_key"]]
            distance_m = round(
                calculate_gps_distance(prev["lat"], prev["lon"], dep["lat"], dep["lon"]), 1
            )
            resolved_action = None
            resolved_at = None
        session.execute(
            text("""
                INSERT INTO feed_events (
                    project_id, camera_id, event_type, deployment_id, site_id,
                    from_site_id, distance_m, created_at, resolved_action, resolved_at
                ) VALUES (
                    :pid, :camera_id, :event_type, :dep_id, :site_id,
                    :from_site_id, :distance_m, :created_at, :resolved_action, :resolved_at
                )
            """),
            {
                "pid": project_id,
                "camera_id": cam_index_to_id[dep["camera_index"]],
                "event_type": event_type,
                "dep_id": dep_key_to_id[dep["key"]],
                "site_id": site_key_to_id[dep["site_key"]],
                "from_site_id": from_site_id,
                "distance_m": distance_m,
                "created_at": created,
                "resolved_action": resolved_action,
                "resolved_at": resolved_at,
            },
        )
    session.execute(
        text("""
            INSERT INTO feed_seen (user_id, project_id, last_seen_at)
            SELECT pm.user_id, :pid,
                   (SELECT MAX(created_at) - INTERVAL '30 days'
                    FROM feed_events WHERE project_id = :pid)
            FROM project_memberships pm WHERE pm.project_id = :pid
        """),
        {"pid": project_id},
    )
    session.flush()


def insert_bulk_jobs(session: Session, jobs: list, project_id: int,
                     cam_index_to_id: dict) -> dict:
    """Insert bulk-upload job rows. Returns {uuid: db_id}. Must run before the
    image insert, since bulk images reference the job."""
    uuid_to_id = {}
    for job in jobs:
        result = session.execute(
            text("""
                INSERT INTO bulk_upload_jobs (
                    uuid, project_id, created_by_user_id, camera_id,
                    original_filename, staged_object_key, status,
                    total_files, processed_files, skipped_files, manifest,
                    created_at, started_at, process_started_at, finished_at
                ) VALUES (
                    :uuid, :pid, :created_by, :camera_id,
                    :orig, :staged, :status,
                    :total, :processed, :skipped, CAST(:manifest AS json),
                    :created_at, :started_at, :process_started_at, :finished_at
                ) RETURNING id
            """),
            {
                "uuid": job["uuid"],
                "pid": project_id,
                "created_by": job["created_by"],
                "camera_id": cam_index_to_id[job["camera_index"]],
                "orig": job["original_filename"],
                "staged": job["staged_object_key"],
                "status": job["status"],
                "total": job["total_files"],
                "processed": job["processed_files"],
                "skipped": job["skipped_files"],
                "manifest": job["manifest"],
                "created_at": job["created_at"],
                "started_at": job["started_at"],
                "process_started_at": job["process_started_at"],
                "finished_at": job["finished_at"],
            },
        )
        uuid_to_id[job["uuid"]] = result.fetchone()[0]
    session.flush()
    return uuid_to_id


def insert_human_observations(session: Session, observations: list, image_uuid_to_id: dict):
    """Insert image-level human observations, resolving images by uuid."""
    for obs in observations:
        image_id = image_uuid_to_id.get(obs["image_uuid"])
        if image_id is None:
            continue
        session.execute(
            text("""
                INSERT INTO human_observations (
                    image_id, species, count, sex, life_stage, behavior,
                    created_by_user_id, created_at
                ) VALUES (
                    :image_id, :species, :count, :sex, :life_stage, :behavior,
                    :created_by, :created_at
                )
            """),
            {
                "image_id": image_id,
                "species": obs["species"],
                "count": obs["count"],
                "sex": obs["sex"],
                "life_stage": obs["life_stage"],
                "behavior": obs["behavior"],
                "created_by": obs["created_by"],
                "created_at": obs["created_at"],
            },
        )
    session.flush()


def insert_rejections(session: Session, rejections: list, project_id: int,
                      device_to_cam_id: dict):
    """Insert rejected-file rows. Known devices link to their camera and the
    project; unknown devices stay unlinked (server-admin page only)."""
    for rj in rejections:
        camera_id = device_to_cam_id.get(rj["device_id"]) if rj["known_device"] else None
        pid = project_id if rj["known_device"] else None
        session.execute(
            text("""
                INSERT INTO rejections (
                    filename, disk_path, reason, details, device_id, camera_id,
                    project_id, captured_at, exif_metadata, file_size_bytes, rejected_at
                ) VALUES (
                    :filename, :disk_path, :reason, :details, :device_id, :camera_id,
                    :pid, :captured_at, CAST(:exif AS json), :size, :rejected_at
                )
            """),
            {
                "filename": rj["filename"],
                "disk_path": rj["disk_path"],
                "reason": rj["reason"],
                "details": rj["details"],
                "device_id": rj["device_id"],
                "camera_id": camera_id,
                "pid": pid,
                "captured_at": rj["captured_at"],
                "exif": rj["exif_metadata"],
                "size": rj["file_size_bytes"],
                "rejected_at": rj["rejected_at"],
            },
        )
    session.flush()


def insert_reminders(session: Session, reminders: list, project_id: int):
    """Insert project reminder digests."""
    for r in reminders:
        session.execute(
            text("""
                INSERT INTO project_reminders (
                    project_id, send_on, message, created_by_user_id, sent_at
                ) VALUES (:pid, :send_on, :message, :created_by, :sent_at)
            """),
            {
                "pid": project_id,
                "send_on": r["send_on"],
                "message": r["message"],
                "created_by": r["created_by"],
                "sent_at": r["sent_at"],
            },
        )
    session.flush()


def insert_project_documents(session: Session, project_id: int, uploaded_by: int) -> int:
    """Upload a few example documents to storage and register them, to showcase
    the project documents feature. Returns the number inserted."""
    storage = StorageClient()
    docs = demo_documents()
    for filename, content_type, description, content in docs:
        storage_path = f"{project_id}/{uuid.uuid4()}_{filename}"
        storage.upload_fileobj(io.BytesIO(content), BUCKET_PROJECT_DOCUMENTS, storage_path)
        session.execute(
            text("""
                INSERT INTO project_documents (
                    project_id, original_filename, storage_path, file_size,
                    content_type, description, uploaded_by_user_id
                ) VALUES (:pid, :name, :path, :size, :ctype, :descr, :uid)
            """),
            {
                "pid": project_id,
                "name": filename,
                "path": storage_path,
                "size": len(content),
                "ctype": content_type,
                "descr": description,
                "uid": uploaded_by,
            },
        )
    session.flush()
    return len(docs)


def update_camera_latest_fields(session: Session, cam_index_to_id: dict, cameras: list):
    """Update cameras with latest health/image data and config JSON."""
    cam_by_index = {cam["index"]: cam for cam in cameras}

    for cam_index, cam_db_id in cam_index_to_id.items():
        cam = cam_by_index[cam_index]

        # Never-deployed cameras stay as inventory with no config/location
        if cam.get("never_deployed"):
            continue

        # Get latest health report for this camera
        latest = session.execute(
            text("""
                SELECT battery_percent, signal_quality, temperature_c,
                       sd_utilization_percent, total_images, sent_images
                FROM camera_health_reports
                WHERE camera_id = :cid
                ORDER BY reported_at DESC LIMIT 1
            """),
            {"cid": cam_db_id},
        ).fetchone()

        config = None
        battery = None
        temp = None
        signal = None

        if latest:
            battery = latest[0]
            signal = latest[1]
            temp = latest[2]

            config = {
                "last_health_report": {
                    "signal_quality": signal,
                    "temperature": temp,
                    "battery_percentage": battery,
                    "sd_utilization_percentage": latest[3],
                    "total_images": latest[4],
                    "sent_images": latest[5],
                },
                "gps_from_report": {
                    "lat": cam["current_lat"],
                    "lon": cam["current_lon"],
                },
            }

        session.execute(
            text("""
                UPDATE cameras SET
                    battery_percent = :battery,
                    temperature_c = :temp,
                    signal_quality = :signal,
                    config = CAST(:config AS json)
                WHERE id = :cid
            """),
            {
                "cid": cam_db_id,
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
    """Insert notification preferences for the first few project members."""
    member_emails = [
        u["email"] for u in DEMO_USERS
        if u["role"] in ("project-admin", "project-viewer")
        and u["is_active"] and u["is_verified"] and u["email"] in user_ids
    ]
    notif_users = [(email, str(100001 + i)) for i, email in enumerate(member_emails[:4])]

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
    print("[1/6] Uploading demo images to MinIO...")
    species_image_info = upload_demo_images()
    print("   Done.")

    with Session(engine) as session:
        # Step 2: Clean and configure
        print("[2/6] Cleaning existing demo data...")
        clean_demo_data(session)
        insert_server_settings(session)
        session.commit()

        # Step 3: Project and users
        print("[3/6] Creating project and users...")
        project_id = insert_project(session)
        set_project_image(session, project_id, species_image_info)
        user_ids = insert_users(session, project_id)
        # Users that curate (verify / like / observe): active, verified project
        # members. Attribution is by role, not hardcoded emails.
        member_emails = [
            u["email"] for u in DEMO_USERS
            if u["role"] in ("project-admin", "project-viewer")
            and u["is_active"] and u["is_verified"] and u["email"] in user_ids
        ]
        members = [user_ids[e] for e in member_emails]
        admin_creator = next(
            (user_ids[u["email"]] for u in DEMO_USERS
             if u["role"] == "project-admin" and u["email"] in user_ids),
            members[0],
        )
        print(f"   Project '{PROJECT_NAME}' (id={project_id}) and {len(user_ids)} users created.")

        # Step 4: Generate everything in memory
        print("[4/6] Generating data in memory...")
        sites, cameras, deployments = generate_layout(rng)
        print(f"   {len(sites)} sites, {len(cameras)} cameras, {len(deployments)} deployments.")

        images, detections, classifications, counters = generate_all_data(
            deployments, cameras, rng, species_image_info
        )
        curate_first_page(images, detections, classifications, species_image_info, rng)
        observations = generate_curation_and_observations(
            images, detections, classifications, members, rng
        )

        job_uuid = str(uuid.uuid4())
        bulk_images, bulk_dets, bulk_cls, bulk_cam_index, win_start, win_end = generate_bulk_data(
            deployments, cameras, rng, species_image_info, counters, job_uuid
        )
        bulk_job = build_bulk_job_record(
            job_uuid, bulk_cam_index, win_start, win_end, len(bulk_images), admin_creator
        )
        images += bulk_images
        detections += bulk_dets
        classifications += bulk_cls

        health_reports = generate_health_reports(cameras, rng)
        rejections = generate_rejections(cameras, rng)
        reminders = generate_reminders(admin_creator)
        print(f"   {len(images)} images ({len(bulk_images)} bulk), {len(detections)} detections, "
              f"{len(classifications)} classifications.")
        print(f"   {len(observations)} observations, {len(rejections)} rejections, "
              f"{len(reminders)} reminders, {len(health_reports)} health reports.")

        # Step 5: Insert in FK order
        print("[5/6] Inserting into the database...")
        # Row counts captured before the big lists are freed below.
        counts = {
            "sites": len(sites), "cameras": len(cameras), "deployments": len(deployments),
            "images": len(images), "bulk": len(bulk_images), "detections": len(detections),
            "classifications": len(classifications), "observations": len(observations),
            "health": len(health_reports), "rejections": len(rejections), "reminders": len(reminders),
        }

        # Commit in stages and free each big list once inserted. The demo VM is
        # small (4 GB, no swap); one giant transaction plus all the data held in
        # memory at once overruns it. Staged commits keep Postgres from holding
        # a single multi-hundred-thousand-row transaction, and the del + gc keep
        # Python's resident set down.
        site_key_to_id = insert_sites(session, sites, project_id)
        cam_index_to_id = insert_cameras(session, cameras, project_id, species_image_info)
        dep_key_to_id = insert_deployments(session, deployments, cam_index_to_id, site_key_to_id)
        insert_feed_events(session, deployments, cam_index_to_id, site_key_to_id,
                           dep_key_to_id, project_id)
        job_uuid_to_id = insert_bulk_jobs(session, [bulk_job], project_id, cam_index_to_id)
        device_to_cam_id = {cam["device_id"]: cam_index_to_id[cam["index"]] for cam in cameras}
        session.commit()
        del sites, deployments, bulk_images
        gc.collect()

        print(f"   Inserting {counts['images']} images...")
        image_uuid_to_id = insert_images_batch(
            session, images, cam_index_to_id, dep_key_to_id, job_uuid_to_id
        )
        session.commit()

        print(f"   Inserting {counts['detections']} detections...")
        old_to_new_det = insert_detections_batch(session, detections, image_uuid_to_id, images)
        session.commit()
        del images, detections
        gc.collect()

        print(f"   Inserting {counts['classifications']} classifications...")
        insert_classifications_batch(session, classifications, old_to_new_det)
        session.commit()
        del classifications, old_to_new_det
        gc.collect()

        insert_human_observations(session, observations, image_uuid_to_id)
        session.commit()
        del observations, image_uuid_to_id
        gc.collect()

        insert_health_reports_batch(session, health_reports, cam_index_to_id)
        update_camera_latest_fields(session, cam_index_to_id, cameras)
        session.commit()
        del health_reports
        gc.collect()

        insert_rejections(session, rejections, project_id, device_to_cam_id)
        insert_reminders(session, reminders, project_id)
        n_docs = insert_project_documents(session, project_id, admin_creator)

        # Step 6: Telegram and notification preferences
        print("[6/6] Setting up Telegram and notification preferences...")
        insert_telegram_config(session)
        insert_notification_preferences(session, project_id, user_ids)
        session.commit()

    print()
    print("=" * 60)
    print("  Demo data population complete!")
    print("=" * 60)
    print()
    print(f"  Project: {PROJECT_NAME}")
    print(f"  Date range: {DATE_START} to {DATE_END}")
    print(f"  Sites: {counts['sites']}")
    print(f"  Cameras: {counts['cameras']}")
    print(f"  Deployments: {counts['deployments']}")
    print(f"  Users: {len(DEMO_USERS)}")
    print(f"  Images:  {counts['images']} ({counts['bulk']} from bulk upload)")
    print(f"  Detections: {counts['detections']}")
    print(f"  Classifications: {counts['classifications']}")
    print(f"  Human observations: {counts['observations']}")
    print(f"  Health reports: {counts['health']}")
    print(f"  Rejections: {counts['rejections']}")
    print(f"  Reminders: {counts['reminders']}")
    print(f"  Documents: {n_docs}")
    total = (
        1 + len(DEMO_USERS) + counts["sites"] + counts["cameras"] + counts["deployments"]
        + counts["images"] + counts["detections"] + counts["classifications"]
        + counts["observations"] + counts["health"] + counts["rejections"] + counts["reminders"]
    )
    print(f"  Total DB rows: ~{total:,}")
    print()
    print(f"  Login: demo@email.com / xK9#mW2$vQ7!bN4p (project-admin)")
    print()


if __name__ == "__main__":
    main()
