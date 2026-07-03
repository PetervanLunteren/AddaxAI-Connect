"""
Dev-only simulator for the camera updates feed. TEMPORARY, delete after testing.

Drives the real ingestion path (create_image_record, which runs the site and
deployment resolver) with synthetic labeled photos, so the feed, the GPS
debounce, the running-mean pin, and the merges behave exactly like production.
Nothing is mocked and nothing is reimplemented.

All simulated data lives in a geographic sandbox (the Wadden Sea around the
island Griend) with SIM-prefixed device ids, so `reset` can wipe it without
touching real data. Run one scenario, look at the UI, then run the next.

Run inside the ingestion container on the dev server:

    docker compose exec -T ingestion python /app/scripts/dev_simulate_feed.py <scenario>

Scenarios, in the intended order:
    solo-new       SIM01 sends its first photos -> one "started sending" entry
    solo-noise     SIM01 sends one 300 m outlier -> nothing happens (debounce)
    solo-move      SIM01 sends two photos 1.5 km away -> one "moved" entry
    bridge         SIM02..SIM05 hang on one wildlife bridge (~60 m apart)
                   -> four "started" entries, all on one shared site; split
                   them with the "New site" button
    not-moved      SIM06 seeded, then a fake 400 m move -> one "moved" entry
                   to undo with the "It did not move" button
    rotation-seed  SIM10..SIM15 at stations A1..A6 (auto-renamed, simulating
                   the one-time naming pass a user would do once)
    rotation-out   all six move ~1 km east to new B spots -> six grouped entries
    rotation-back  all six return to the A stations, shuffled -> six entries
                   that snap to the existing named stations, nothing to fix
    swap           SIM20 and SIM21 swap places between two sites in one day
    reset          delete every simulated camera, image, site, and feed entry
"""
import argparse
import os
import sys
import tempfile
import uuid as uuid_module
from datetime import datetime

# Ingestion service code (db_operations, storage_operations) lives at /app in
# the ingestion container.
sys.path.insert(0, "/app")

from PIL import Image as PILImage, ImageDraw, ImageFont
from sqlalchemy import text

from shared.database import get_db_session
from shared.models import Camera
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS

from db_operations import create_image_record, get_camera_by_device_id, get_server_timezone
from storage_operations import upload_image_to_minio, generate_and_upload_thumbnail

# ---------------------------------------------------------------------------
# Sandbox geography. Everything sits around Griend (Wadden Sea), far from any
# real deployment, and inside RESET_BBOX so reset can delete sim sites safely.
# At 53.25 N: 0.001 deg lat is ~111 m, 0.001 deg lon is ~66 m.
# ---------------------------------------------------------------------------
RESET_BBOX = {"lat_min": 53.20, "lat_max": 53.35, "lon_min": 5.15, "lon_max": 5.35}

SOLO_HOME = (53.2460, 5.2620)
SOLO_NOISE = (53.2487, 5.2620)        # ~300 m north of home
SOLO_MOVED = (53.2460, 5.2845)        # ~1.5 km east of home

BRIDGE = {                             # four corners ~30 m from the center
    "SIM02": (53.25827, 5.24500),      # north
    "SIM03": (53.25800, 5.24545),      # east
    "SIM04": (53.25773, 5.24500),      # south
    "SIM05": (53.25800, 5.24455),      # west
}

NOT_MOVED_HOME = (53.2400, 5.2200)
NOT_MOVED_FAKE = (53.2400, 5.2260)     # ~400 m east

# Six stations 300 m apart going north, and a B row 1 km east of each.
ROTATION_CAMS = ["SIM10", "SIM11", "SIM12", "SIM13", "SIM14", "SIM15"]
STATIONS_A = [(53.2700 + i * 0.0027, 5.2300) for i in range(6)]
STATIONS_B = [(lat, lon + 0.0150) for lat, lon in STATIONS_A]
# Who ends up where on the way back (index into STATIONS_A), deliberately
# shuffled: the point is that station identity survives camera shuffling.
ROTATION_SHUFFLE = [2, 0, 1, 4, 5, 3]

SWAP_WEST = (53.2350, 5.2700)
SWAP_EAST = (53.2350, 5.2850)          # ~1 km east

# One fill color per camera so the feed thumbnails are tellable apart.
PALETTE = [
    (15, 96, 100), (140, 80, 30), (60, 110, 60), (110, 50, 110),
    (50, 70, 130), (130, 60, 60), (90, 90, 40), (40, 100, 100),
]


def now_naive() -> datetime:
    """Camera wall-clock now, naive, matching how ingestion stores captured_at."""
    return datetime.now(get_server_timezone()).replace(tzinfo=None)


def make_photo(device_id: str, note: str) -> str:
    """Write a labeled JPEG to a temp file and return its path."""
    color = PALETTE[hash(device_id) % len(PALETTE)]
    img = PILImage.new("RGB", (640, 480), color=color)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:  # older Pillow without the size argument
        font = ImageFont.load_default()
    draw.text((30, 180), f"{device_id}\n{note}", fill="white", font=font)
    fd, path = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    img.save(path, "JPEG")
    return path


def ensure_camera(device_id: str, project_id: int) -> int:
    """Register the camera if needed (mirrors manual registration) and return its db id."""
    existing = get_camera_by_device_id(device_id)
    if existing is not None:
        return existing
    with get_db_session() as session:
        camera = Camera(device_id=device_id, project_id=project_id,
                        status='inventory', config={}, notes='dev feed simulator')
        session.add(camera)
        session.flush()
        camera_id = camera.id
    print(f"  registered camera {device_id}")
    return camera_id


def send_photo(device_id: str, project_id: int, lat: float, lon: float, note: str) -> None:
    """One synthetic photo through the real ingestion path."""
    camera_id = ensure_camera(device_id, project_id)
    image_uuid = str(uuid_module.uuid4())
    filename = f"{note.replace(' ', '_')}.jpg"
    path = make_photo(device_id, note)
    try:
        storage_path = upload_image_to_minio(path, device_id, image_uuid, filename)
        thumbnail_path = generate_and_upload_thumbnail(path, device_id, image_uuid, filename)
        create_image_record(
            image_uuid=image_uuid,
            camera_id=camera_id,
            filename=filename,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            captured_at=now_naive(),
            gps_location=(lat, lon),
            exif_metadata={"source": "dev_simulate_feed", "note": note},
        )
    finally:
        os.unlink(path)
    print(f"  {device_id} photo at ({lat:.5f}, {lon:.5f})  [{note}]")


def rename_current_site(device_id: str, name: str) -> None:
    """Rename the site of a camera's active deployment, simulating the
    one-time naming a user does through the feed."""
    with get_db_session() as session:
        session.execute(
            text("""
                UPDATE sites SET name = :name
                WHERE id = (
                    SELECT d.site_id FROM deployments d
                    JOIN cameras c ON c.id = d.camera_id
                    WHERE c.device_id = :device_id AND d.end_date IS NULL
                )
            """),
            {"name": name, "device_id": device_id},
        )
    print(f"  renamed {device_id}'s site to \"{name}\" (simulated naming pass)")


def expect(lines: list[str]) -> None:
    print("\nCheck in the UI (Cameras page -> Updates):")
    for line in lines:
        print(f"  - {line}")
    print()


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def solo_new(pid: int) -> None:
    for i in range(3):
        send_photo("SIM01", pid, SOLO_HOME[0] + i * 0.00004, SOLO_HOME[1], f"first photo {i + 1}")
    expect([
        "One entry: camera SIM01 started sending images, placed at an auto-named site.",
        "Badge on the Cameras nav item shows 1 (until the panel is opened).",
        "Try the Rename site button, call it for example 'Griend east'.",
        "The entry has three thumbnails, all the same color with 'SIM01' on them.",
    ])


def solo_noise(pid: int) -> None:
    send_photo("SIM01", pid, *SOLO_NOISE, note="gps outlier")
    send_photo("SIM01", pid, *SOLO_HOME, note="back home 1")
    send_photo("SIM01", pid, SOLO_HOME[0], SOLO_HOME[1] + 0.00005, "back home 2")
    expect([
        "Nothing new. The 300 m outlier was held by the debounce and dropped",
        "when the camera reported from home again. No entry, no phantom site.",
    ])


def solo_move(pid: int) -> None:
    send_photo("SIM01", pid, *SOLO_MOVED, note="moved reading 1")
    send_photo("SIM01", pid, SOLO_MOVED[0] + 0.00005, SOLO_MOVED[1], "moved reading 2")
    expect([
        "One entry: camera SIM01 moved about 1.5 km, now at a new auto-named site,",
        "with 'It was at <old site> before.'",
        "The move needed two readings; the first alone created no entry.",
        "Try Rename site on the new spot.",
    ])


def bridge(pid: int) -> None:
    for device_id, (lat, lon) in BRIDGE.items():
        for i in range(2):
            send_photo(device_id, pid, lat + i * 0.00003, lon, f"bridge photo {i + 1}")
    expect([
        "Four entries, one per camera. The first camera created a site; the",
        "other three snapped onto the same site (they are within 250 m).",
        "Rename the shared site to 'Wildlife bridge'.",
        "Then use New site on three of them ('bridge north', 'bridge south',",
        "'bridge west') to split the bridge into per-camera sites.",
        "After splitting, the Different site button appears on these entries,",
        "because several sites now sit within 250 m of each other.",
    ])


def not_moved(pid: int) -> None:
    for i in range(2):
        send_photo("SIM06", pid, NOT_MOVED_HOME[0] + i * 0.00004, NOT_MOVED_HOME[1], f"home photo {i + 1}")
    send_photo("SIM06", pid, *NOT_MOVED_FAKE, note="bad gps 1")
    send_photo("SIM06", pid, NOT_MOVED_FAKE[0] + 0.00004, NOT_MOVED_FAKE[1], "bad gps 2")
    expect([
        "Two entries for SIM06: started sending, and moved about 400 m.",
        "Click It did not move on the move entry. The camera goes back to its",
        "previous site, the split deployment folds back together, and the",
        "image count on the site is whole again (check the site slideout).",
    ])


def rotation_seed(pid: int) -> None:
    for device_id, (lat, lon) in zip(ROTATION_CAMS, STATIONS_A):
        for i in range(2):
            send_photo(device_id, pid, lat + i * 0.00003, lon, f"station photo {i + 1}")
    for i, device_id in enumerate(ROTATION_CAMS):
        rename_current_site(device_id, f"Station A{i + 1}")
    expect([
        "Six 'started sending' entries. The station sites were auto-renamed to",
        "Station A1..A6 here, simulating the one-time naming pass (the rename",
        "flow itself was already exercised in solo-new).",
    ])


def rotation_out(pid: int) -> None:
    for device_id, (lat, lon) in zip(ROTATION_CAMS, STATIONS_B):
        send_photo(device_id, pid, lat, lon, "b row reading 1")
        send_photo(device_id, pid, lat + 0.00004, lon, "b row reading 2")
    expect([
        "Six 'moved about 1.0 km' entries, grouped under today, each saying",
        "which A station the camera left. The B spots are new auto-named sites;",
        "rename one or two if you want.",
    ])


def rotation_back(pid: int) -> None:
    for device_id, target in zip(ROTATION_CAMS, ROTATION_SHUFFLE):
        lat, lon = STATIONS_A[target]
        send_photo(device_id, pid, lat, lon, "back at a station 1")
        send_photo(device_id, pid, lat + 0.00004, lon, "back at a station 2")
    expect([
        "Six 'moved' entries, and every one snapped onto an existing named",
        "Station A site, even though the cameras came back shuffled (SIM10 is",
        "now at Station A3, and so on). Nothing needs fixing, no new sites,",
        "no renames. This is the rotation-project case working end to end.",
    ])


def swap(pid: int) -> None:
    for i in range(2):
        send_photo("SIM20", pid, SWAP_WEST[0] + i * 0.00003, SWAP_WEST[1], f"seed photo {i + 1}")
        send_photo("SIM21", pid, SWAP_EAST[0] + i * 0.00003, SWAP_EAST[1], f"seed photo {i + 1}")
    for i in range(2):
        send_photo("SIM20", pid, SWAP_EAST[0] + i * 0.00004, SWAP_EAST[1], f"swapped {i + 1}")
        send_photo("SIM21", pid, SWAP_WEST[0] + i * 0.00004, SWAP_WEST[1], f"swapped {i + 1}")
    expect([
        "Four entries: SIM20 and SIM21 started sending, then both moved in the",
        "same run, trading places. Each snapped onto the other's existing site,",
        "no duplicate sites appeared.",
    ])


def reset(pid: int) -> None:
    storage = StorageClient()
    for bucket in (BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS):
        for obj in storage.list_objects(bucket, prefix="SIM"):
            storage.delete_object(bucket, obj)
    with get_db_session() as session:
        sim_images = "SELECT i.id FROM images i JOIN cameras c ON c.id = i.camera_id WHERE c.device_id LIKE 'SIM%'"
        session.execute(text(f"DELETE FROM classifications WHERE detection_id IN (SELECT d.id FROM detections d WHERE d.image_id IN ({sim_images}))"))
        session.execute(text(f"DELETE FROM detections WHERE image_id IN ({sim_images})"))
        session.execute(text(f"DELETE FROM human_observations WHERE image_id IN ({sim_images})"))
        session.execute(text("DELETE FROM images WHERE camera_id IN (SELECT id FROM cameras WHERE device_id LIKE 'SIM%')"))
        # Cascades deployments and feed_events.
        session.execute(text("DELETE FROM cameras WHERE device_id LIKE 'SIM%'"))
        deleted_sites = session.execute(
            text("""
                DELETE FROM sites
                WHERE project_id = :pid
                  AND ST_Y(location::geometry) BETWEEN :lat_min AND :lat_max
                  AND ST_X(location::geometry) BETWEEN :lon_min AND :lon_max
            """),
            {"pid": pid, **RESET_BBOX},
        ).rowcount
    print(f"Reset done. Removed all SIM cameras, their images and feed entries, "
          f"and {deleted_sites} sandbox site(s).")


SCENARIOS = {
    "solo-new": solo_new,
    "solo-noise": solo_noise,
    "solo-move": solo_move,
    "bridge": bridge,
    "not-moved": not_moved,
    "rotation-seed": rotation_seed,
    "rotation-out": rotation_out,
    "rotation-back": rotation_back,
    "swap": swap,
    "reset": reset,
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate camera updates feed scenarios on dev.")
    parser.add_argument("scenario", choices=sorted(SCENARIOS))
    parser.add_argument("--project-id", type=int, default=1)
    args = parser.parse_args()
    print(f"=== {args.scenario} (project {args.project_id}) ===")
    SCENARIOS[args.scenario](args.project_id)


if __name__ == "__main__":
    main()
