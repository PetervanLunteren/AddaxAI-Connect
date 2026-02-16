#!/usr/bin/env python3
"""
Populate demo data for AddaxAI Connect.

Creates a complete demo dataset for De Hoge Veluwe National Park (Netherlands)
with 100 cameras, ~50,000 images, detections, classifications, health reports,
and deployment periods spanning 2 years.

Usage:
    docker exec addaxai-api python /app/scripts/populate_demo_data.py
"""
import io
import json
import math
import os
import sys
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

# Park boundaries (camera grid area)
LAT_MIN, LAT_MAX = 52.04, 52.12  # ~9 km north-south
LON_MIN, LON_MAX = 5.75, 5.87    # ~8 km east-west

# Date range: 2 years
DATE_START = date(2024, 1, 1)
DATE_END = date(2025, 12, 31)
NUM_DAYS = (DATE_END - DATE_START).days + 1  # 731

# Camera grid
GRID_ROWS = 10
GRID_COLS = 10
NUM_CAMERAS = GRID_ROWS * GRID_COLS

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

# Demo users
ADMIN_EMAIL = "admin@demo.addaxai.com"
ADMIN_PASSWORD = "demo2024!"
VIEWER_EMAIL = "viewer@demo.addaxai.com"
VIEWER_PASSWORD = "demo2024!"

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
    "roe_deer":    (0.75, 0.99),
    "fox":         (0.70, 0.98),
    "wild_boar":   (0.72, 0.99),
    "red_deer":    (0.73, 0.98),
    "lagomorph":   (0.65, 0.95),
    "fallow_deer": (0.68, 0.97),
    "mouflon":     (0.60, 0.95),
    "bird":        (0.55, 0.90),
    "mustelid":    (0.58, 0.92),
    "wolf":        (0.55, 0.90),
    "hedgehog":    (0.60, 0.92),
    "squirrel":    (0.62, 0.93),
    "cat":         (0.60, 0.93),
    "dog":         (0.65, 0.95),
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


def camera_zone(row: int, col: int) -> set:
    """Return zone tags for a camera grid position."""
    zones = set()
    if row <= 2:
        zones.add("north")
    if row >= 7 and col >= 7:
        zones.add("south_east")
    if 3 <= row <= 6 and col <= 3:
        zones.add("central_west")
    if row == 0 or row == 9 or col == 0 or col == 9:
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


# ---------------------------------------------------------------------------
# Data generation functions
# ---------------------------------------------------------------------------

def generate_cameras() -> list:
    """Generate 100 cameras on a 10x10 grid spanning the park."""
    cameras = []
    lat_step = (LAT_MAX - LAT_MIN) / (GRID_ROWS - 1)
    lon_step = (LON_MAX - LON_MIN) / (GRID_COLS - 1)

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            idx = row * GRID_COLS + col
            lat = LAT_MIN + row * lat_step
            lon = LON_MIN + col * lon_step
            imei = f"DHV{idx + 1:03d}"
            cameras.append({
                "index": idx,
                "row": row,
                "col": col,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "imei": imei,
                "name": f"Camera {imei}",
                "zones": camera_zone(row, col),
            })
    return cameras


def generate_all_data(cameras: list, rng: Random):
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
        cam_id_offset = cam["index"]  # will be replaced with actual DB id later

        for day_offset in range(NUM_DAYS):
            current_date = DATE_START + timedelta(days=day_offset)
            season = get_season(current_date)

            # Seasonal global multiplier
            rate = IMAGES_PER_CAMERA_PER_DAY
            if season == "winter":
                rate *= WINTER_GLOBAL_MULTIPLIER

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

                # Image metadata (EXIF-like)
                dt_original = capture_dt.strftime("%Y:%m:%d %H:%M:%S")
                metadata = {
                    "width": IMG_WIDTH,
                    "height": IMG_HEIGHT,
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
                    "storage_path": PLACEHOLDER_STORAGE_PATH,
                    "thumbnail_path": PLACEHOLDER_THUMBNAIL_PATH,
                    "status": "classified",
                    "image_metadata": json.dumps(metadata),
                }
                all_images.append(image_rec)

                # Generate detection (if not empty)
                if category is not None:
                    det_confidence = round(rng.uniform(0.3, 0.985), 4)

                    # Bbox size depends on category
                    if category == "animal":
                        w_frac = rng.uniform(0.15, 0.40)
                        h_frac = rng.uniform(0.15, 0.40)
                    elif category == "person":
                        w_frac = rng.uniform(0.10, 0.25)
                        h_frac = rng.uniform(0.30, 0.60)
                    else:  # vehicle
                        w_frac = rng.uniform(0.20, 0.50)
                        h_frac = rng.uniform(0.15, 0.30)

                    # Random position, clamped to image
                    max_x = 1.0 - w_frac
                    max_y = 1.0 - h_frac
                    x_norm = rng.uniform(0.0, max(max_x, 0.01))
                    y_norm = rng.uniform(0.0, max(max_y, 0.01))

                    x_px = int(x_norm * IMG_WIDTH)
                    y_px = int(y_norm * IMG_HEIGHT)
                    w_px = int(w_frac * IMG_WIDTH)
                    h_px = int(h_frac * IMG_HEIGHT)

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
        battery = 100
        sd_util = 0.0
        total_images = 0
        sent_images = 0
        # Per-camera signal baseline
        signal_base = rng.randint(12, 22)

        for day_offset in range(NUM_DAYS):
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

            # SD utilization: gradual increase, occasional reset
            daily_imgs = rng.randint(0, 3)
            total_images += daily_imgs
            sent_images += max(0, daily_imgs - rng.randint(0, 1))
            sd_util += daily_imgs * 0.015  # ~1.5% per image
            if sd_util > 85 or rng.random() < 0.005:
                sd_util = rng.uniform(0, 5)  # card swap or cleanup
            sd_util = min(sd_util, 99.0)

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

    if not project_row:
        print("   No existing demo data found.")
        return

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

    # Delete project memberships and project
    session.execute(text("DELETE FROM project_memberships WHERE project_id = :pid"), {"pid": project_id})
    session.execute(text("DELETE FROM projects WHERE id = :pid"), {"pid": project_id})

    # Delete demo users
    for email in (ADMIN_EMAIL, VIEWER_EMAIL):
        session.execute(text("DELETE FROM users WHERE email = :email"), {"email": email})

    session.flush()
    print("   Cleanup complete.")


def insert_project(session: Session) -> int:
    """Create project with PostGIS polygon boundary."""
    boundary_wkt = (
        f"POLYGON(({LON_MIN} {LAT_MIN}, {LON_MAX} {LAT_MIN}, "
        f"{LON_MAX} {LAT_MAX}, {LON_MIN} {LAT_MAX}, {LON_MIN} {LAT_MIN}))"
    )
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


def insert_users(session: Session, project_id: int) -> tuple:
    """Create demo users and project membership. Returns (admin_id, viewer_id)."""
    admin_hash = pwd_context.hash(ADMIN_PASSWORD)
    viewer_hash = pwd_context.hash(VIEWER_PASSWORD)

    admin_result = session.execute(
        text("""
            INSERT INTO users (email, hashed_password, is_active, is_superuser, is_verified)
            VALUES (:email, :pw, true, true, true)
            RETURNING id
        """),
        {"email": ADMIN_EMAIL, "pw": admin_hash},
    )
    admin_id = admin_result.fetchone()[0]

    viewer_result = session.execute(
        text("""
            INSERT INTO users (email, hashed_password, is_active, is_superuser, is_verified)
            VALUES (:email, :pw, true, false, true)
            RETURNING id
        """),
        {"email": VIEWER_EMAIL, "pw": viewer_hash},
    )
    viewer_id = viewer_result.fetchone()[0]

    # Assign viewer to project
    session.execute(
        text("""
            INSERT INTO project_memberships (user_id, project_id, role, added_by_user_id)
            VALUES (:uid, :pid, 'project-viewer', :admin_id)
        """),
        {"uid": viewer_id, "pid": project_id, "admin_id": admin_id},
    )
    session.flush()
    return admin_id, viewer_id


def insert_cameras(session: Session, cameras: list, project_id: int) -> dict:
    """Bulk insert cameras. Returns {camera_index: db_id} mapping."""
    index_to_id = {}
    for cam in cameras:
        result = session.execute(
            text("""
                INSERT INTO cameras (
                    name, imei, manufacturer, model, project_id,
                    status, has_sim, location, installed_at
                ) VALUES (
                    :name, :imei, :make, :model, :pid,
                    'active', true,
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
        text("SELECT uuid, id FROM images WHERE storage_path = :path"),
        {"path": PLACEHOLDER_STORAGE_PATH},
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


def update_camera_latest_fields(session: Session, cam_index_to_id: dict):
    """Update cameras with latest health/image data from generated records."""
    for cam_index, cam_db_id in cam_index_to_id.items():
        session.execute(
            text("""
                UPDATE cameras SET
                    last_image_at = (
                        SELECT MAX(uploaded_at) FROM images WHERE camera_id = :cid
                    ),
                    last_seen = (
                        SELECT MAX(uploaded_at) FROM images WHERE camera_id = :cid
                    ),
                    last_daily_report_at = (
                        SELECT MAX(report_date)::timestamp with time zone
                        FROM camera_health_reports WHERE camera_id = :cid
                    ),
                    battery_percent = (
                        SELECT battery_percent FROM camera_health_reports
                        WHERE camera_id = :cid ORDER BY report_date DESC LIMIT 1
                    ),
                    temperature_c = (
                        SELECT temperature_c FROM camera_health_reports
                        WHERE camera_id = :cid ORDER BY report_date DESC LIMIT 1
                    ),
                    signal_quality = (
                        SELECT signal_quality FROM camera_health_reports
                        WHERE camera_id = :cid ORDER BY report_date DESC LIMIT 1
                    )
                WHERE id = :cid
            """),
            {"cid": cam_db_id},
        )
    session.flush()


# ---------------------------------------------------------------------------
# MinIO function
# ---------------------------------------------------------------------------

def upload_placeholder_images():
    """Generate and upload 1 raw + 1 thumbnail placeholder to MinIO."""
    storage = StorageClient()

    raw_bytes = generate_placeholder_image()
    thumb_bytes = generate_thumbnail(raw_bytes)

    storage.upload_fileobj(
        io.BytesIO(raw_bytes), BUCKET_RAW_IMAGES, PLACEHOLDER_STORAGE_PATH
    )
    storage.upload_fileobj(
        io.BytesIO(thumb_bytes), BUCKET_THUMBNAILS, PLACEHOLDER_THUMBNAIL_PATH
    )


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
    print("[1/8] Uploading placeholder images to MinIO...")
    upload_placeholder_images()
    print("   Done.")

    with Session(engine) as session:
        # Step 2: Clean
        print("[2/8] Cleaning existing demo data...")
        clean_demo_data(session)
        session.commit()

        # Step 3: Project
        print("[3/8] Creating project...")
        project_id = insert_project(session)
        print(f"   Project '{PROJECT_NAME}' created (id={project_id}).")

        # Step 4: Users
        print("[4/8] Creating users...")
        admin_id, viewer_id = insert_users(session, project_id)
        print(f"   Admin: {ADMIN_EMAIL} (id={admin_id})")
        print(f"   Viewer: {VIEWER_EMAIL} (id={viewer_id})")

        # Step 5: Generate data in memory
        print("[5/8] Generating all data in memory...")
        cameras = generate_cameras()
        print(f"   {len(cameras)} cameras defined.")

        images, detections, classifications = generate_all_data(cameras, rng)
        print(f"   {len(images)} images generated.")
        print(f"   {len(detections)} detections generated.")
        print(f"   {len(classifications)} classifications generated.")

        health_reports = generate_health_reports(cameras, rng)
        print(f"   {len(health_reports)} health reports generated.")

        deployment_periods = generate_deployment_periods(cameras)
        print(f"   {len(deployment_periods)} deployment periods generated.")

        # Step 6: Insert cameras
        print("[6/8] Inserting cameras...")
        cam_index_to_id = insert_cameras(session, cameras, project_id)
        print(f"   {len(cam_index_to_id)} cameras inserted.")

        # Step 7: Insert images, detections, classifications
        print("[7/8] Inserting images, detections, classifications...")
        print(f"   Inserting {len(images)} images...")
        image_uuid_to_id = insert_images_batch(session, images, cam_index_to_id)
        print(f"   Inserting {len(detections)} detections...")
        old_to_new_det = insert_detections_batch(session, detections, image_uuid_to_id, images)
        print(f"   Inserting {len(classifications)} classifications...")
        insert_classifications_batch(session, classifications, old_to_new_det)

        # Step 8: Health reports and deployment periods
        print("[8/8] Inserting health reports and deployment periods...")
        insert_health_reports_batch(session, health_reports, cam_index_to_id)
        insert_deployment_periods(session, deployment_periods, cam_index_to_id)

        # Update camera fields from generated data
        print("   Updating camera latest fields...")
        update_camera_latest_fields(session, cam_index_to_id)

        # Commit everything
        print("   Committing...")
        session.commit()

    print()
    print("=" * 60)
    print("  Demo data population complete!")
    print("=" * 60)
    print()
    print(f"  Project: {PROJECT_NAME}")
    print(f"  Cameras: {NUM_CAMERAS}")
    print(f"  Images:  {len(images)}")
    print(f"  Detections: {len(detections)}")
    print(f"  Classifications: {len(classifications)}")
    print(f"  Health reports: {len(health_reports)}")
    print(f"  Deployment periods: {len(deployment_periods)}")
    total = (
        1 + 2 + 1 + NUM_CAMERAS + len(images) + len(detections)
        + len(classifications) + len(health_reports) + len(deployment_periods)
    )
    print(f"  Total DB rows: ~{total:,}")
    print()
    print("  Login credentials:")
    print(f"    Admin:  {ADMIN_EMAIL} / {ADMIN_PASSWORD}")
    print(f"    Viewer: {VIEWER_EMAIL} / {VIEWER_PASSWORD}")
    print()


if __name__ == "__main__":
    main()
