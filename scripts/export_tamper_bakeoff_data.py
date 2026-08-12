#!/usr/bin/env python3
"""
Export a labelled dataset for the tamper-detection bake-off.

Read-only. Pulls per-camera image history, detections, and the two ground
truth signals for framing changes (camera_moved feed events and maintenance
visits) into CSV files, plus a sampled set of 300 px thumbnails. The
analysis itself (dHash vs ORB vs DINOv2, person-proximity percentiles)
runs offline on a development machine, not on the server.

Two subcommands:

    scope    print ground-truth counts and an export size estimate, so we
             can judge whether the data supports the bake-off before
             downloading anything
    export   write the CSVs and thumbnails to --output

Run from inside the api container on the DEV server only:

    docker compose exec api python /app/scripts/export_tamper_bakeoff_data.py scope
    docker compose exec api python /app/scripts/export_tamper_bakeoff_data.py export

Then copy the result out and down to the analysis machine:

    docker compose cp api:/app/bakeoff-export ./bakeoff-export
    tar czf bakeoff-export.tar.gz bakeoff-export

Thumbnail sampling: every live image inside a +/- --window-days window
around a camera_moved event or a maintenance visit is always included
(these windows contain the labelled framing changes). Outside the windows,
images are sampled evenly per camera up to --max-per-camera so the total
stays manageable while each camera keeps a chronological history for the
alert-rate replay. The CSVs always cover all live images regardless of
thumbnail sampling.
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Optional

from botocore.exceptions import ClientError
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared.database import get_sync_session
from shared.logger import get_logger
from shared.models import (
    Camera,
    CameraMaintenanceEvent,
    Deployment,
    Detection,
    FeedEvent,
    Image,
)
from shared.storage import BUCKET_THUMBNAILS, StorageClient

logger = get_logger("tamper-bakeoff-export")

DOWNLOAD_WORKERS = 8
# Average size of a 300 px JPEG q85 thumbnail, for the scope estimate.
THUMB_EST_BYTES = 25_000


def _bbox_norm(bbox: dict[str, Any], meta: Optional[dict[str, Any]]) -> tuple[
    Optional[float], Optional[float], Optional[float], Optional[float]
]:
    """
    Return (x, y, w, h) in 0-1 coordinates for a stored detection bbox.

    New rows carry a precomputed 'normalized' list. Older rows only have
    pixel values, which are normalized against the EXIF width/height when
    available. Returns (None, None, None, None) when neither works.
    """
    norm = bbox.get("normalized")
    if isinstance(norm, (list, tuple)) and len(norm) == 4:
        x, y, w, h = norm
        return float(x), float(y), float(w), float(h)

    width = (meta or {}).get("width")
    height = (meta or {}).get("height")
    if not width or not height:
        return None, None, None, None
    try:
        return (
            float(bbox["x_min"]) / width,
            float(bbox["y_min"]) / height,
            float(bbox["width"]) / width,
            float(bbox["height"]) / height,
        )
    except (KeyError, TypeError, ZeroDivisionError):
        return None, None, None, None


def _load_event_days(
    session: Session, project_id: Optional[int]
) -> dict[int, set[Any]]:
    """
    Per camera, the set of dates on which a labelled framing change may
    have happened: camera_moved feed events (their server date) and
    maintenance visits (their event date).
    """
    days: dict[int, set[Any]] = defaultdict(set)

    moved = select(FeedEvent.camera_id, FeedEvent.created_at).where(
        FeedEvent.event_type == "camera_moved"
    )
    if project_id is not None:
        moved = moved.where(FeedEvent.project_id == project_id)
    for camera_id, created_at in session.execute(moved):
        days[camera_id].add(created_at.date())

    maint = select(
        CameraMaintenanceEvent.camera_id, CameraMaintenanceEvent.event_date
    ).join(Camera, Camera.id == CameraMaintenanceEvent.camera_id)
    if project_id is not None:
        maint = maint.where(Camera.project_id == project_id)
    for camera_id, event_date in session.execute(maint):
        days[camera_id].add(event_date)

    return days


def _select_thumbnails(
    rows: list[Any],
    event_days: set[Any],
    window_days: int,
    max_per_camera: int,
) -> set[int]:
    """
    Pick which of one camera's images get their thumbnail exported.

    rows are (image_id, ingested_at, thumbnail_path) sorted by ingested_at.
    Window images (near a ground-truth event) are always kept. The rest of
    the budget is filled with an even stride over the remaining images so
    the replay keeps chronological coverage.
    """
    with_thumb = [r for r in rows if r.thumbnail_path]

    def in_window(ingested_at: Any) -> bool:
        d = ingested_at.date()
        return any(
            abs((d - event_day).days) <= window_days for event_day in event_days
        )

    window_ids = {r.image_id for r in with_thumb if in_window(r.ingested_at)}
    rest = [r for r in with_thumb if r.image_id not in window_ids]

    budget = max(0, max_per_camera - len(window_ids))
    if len(rest) <= budget:
        sampled_ids = {r.image_id for r in rest}
    elif budget == 0:
        sampled_ids = set()
    else:
        stride = len(rest) / budget
        sampled_ids = {rest[int(i * stride)].image_id for i in range(budget)}

    return window_ids | sampled_ids


def _camera_filter(query: Any, project_id: Optional[int]) -> Any:
    if project_id is not None:
        query = query.join(Camera, Camera.id == Image.camera_id).where(
            Camera.project_id == project_id
        )
    return query


def cmd_scope(args: argparse.Namespace) -> int:
    with get_sync_session() as session:
        cameras = session.execute(
            select(Camera.id, Camera.device_id, Camera.model, Camera.project_id)
        ).all()
        if args.project_id is not None:
            cameras = [c for c in cameras if c.project_id == args.project_id]
        camera_ids = {c.id for c in cameras}

        live_images = _camera_filter(
            select(Image.camera_id).where(Image.origin == "live"), args.project_id
        )
        per_camera: dict[int, int] = defaultdict(int)
        for (camera_id,) in session.execute(live_images):
            per_camera[camera_id] += 1

        moved = session.execute(
            select(FeedEvent.camera_id, FeedEvent.resolved_action).where(
                FeedEvent.event_type == "camera_moved"
            )
        ).all()
        moved = [m for m in moved if m.camera_id in camera_ids]
        confirmed_moves = [m for m in moved if m.resolved_action != "not_moved"]

        maint_count = 0
        maint_cameras: set[int] = set()
        for camera_id, _ in session.execute(
            select(
                CameraMaintenanceEvent.camera_id,
                CameraMaintenanceEvent.event_date,
            )
        ):
            if camera_id in camera_ids:
                maint_count += 1
                maint_cameras.add(camera_id)

        person_boxes: dict[int, int] = defaultdict(int)
        person_rows = session.execute(
            select(Image.camera_id)
            .join(Detection, Detection.image_id == Image.id)
            .where(Detection.category == "person", Image.origin == "live")
        )
        for (camera_id,) in person_rows:
            if camera_id in camera_ids:
                person_boxes[camera_id] += 1

        event_days = _load_event_days(session, args.project_id)

    total_images = sum(per_camera.values())
    est_thumbs = sum(
        min(count, args.max_per_camera) for count in per_camera.values()
    )
    print(f"cameras: {len(cameras)}")
    print(f"live images: {total_images}")
    print(
        f"camera_moved events: {len(moved)} "
        f"(confirmed or unresolved: {len(confirmed_moves)}, "
        f"resolved not_moved: {len(moved) - len(confirmed_moves)})"
    )
    print(f"maintenance visits: {maint_count} on {len(maint_cameras)} cameras")
    print(f"cameras with ground-truth event days: {len(event_days)}")
    print(f"person detections on live images: {sum(person_boxes.values())}")
    print(
        "cameras with 50+ person detections (adaptive threshold viable): "
        f"{sum(1 for n in person_boxes.values() if n >= 50)}"
    )
    print(
        f"thumbnail export estimate: <= {est_thumbs} files, "
        f"~{est_thumbs * THUMB_EST_BYTES / 1_000_000:.0f} MB "
        f"(window images can push this up)"
    )
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    out = Path(args.output)
    thumbs_dir = out / "thumbs"
    thumbs_dir.mkdir(parents=True, exist_ok=True)

    with get_sync_session() as session:
        event_days = _load_event_days(session, args.project_id)

        cameras_q = select(
            Camera.id, Camera.device_id, Camera.manufacturer, Camera.model,
            Camera.project_id,
        )
        cameras = session.execute(cameras_q).all()
        if args.project_id is not None:
            cameras = [c for c in cameras if c.project_id == args.project_id]
        camera_ids = {c.id for c in cameras}
        with open(out / "cameras.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["camera_id", "device_id", "manufacturer", "model", "project_id"])
            for c in cameras:
                w.writerow([c.id, c.device_id, c.manufacturer, c.model, c.project_id])

        deployments = session.execute(
            select(
                Deployment.id, Deployment.camera_id, Deployment.deployment_number,
                Deployment.site_id, Deployment.start_date, Deployment.end_date,
            )
        ).all()
        with open(out / "deployments.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow([
                "deployment_id", "camera_id", "deployment_number", "site_id",
                "start_date", "end_date",
            ])
            for d in deployments:
                if d.camera_id in camera_ids:
                    w.writerow([
                        d.id, d.camera_id, d.deployment_number, d.site_id,
                        d.start_date, d.end_date or "",
                    ])

        feed_events = session.execute(
            select(
                FeedEvent.id, FeedEvent.camera_id, FeedEvent.event_type,
                FeedEvent.deployment_id, FeedEvent.site_id, FeedEvent.from_site_id,
                FeedEvent.distance_m, FeedEvent.created_at, FeedEvent.resolved_action,
            )
        ).all()
        with open(out / "feed_events.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow([
                "feed_event_id", "camera_id", "event_type", "deployment_id",
                "site_id", "from_site_id", "distance_m", "created_at",
                "resolved_action",
            ])
            for e in feed_events:
                if e.camera_id in camera_ids:
                    w.writerow([
                        e.id, e.camera_id, e.event_type, e.deployment_id or "",
                        e.site_id or "", e.from_site_id or "", e.distance_m or "",
                        e.created_at.isoformat(), e.resolved_action or "",
                    ])

        maint = session.execute(
            select(
                CameraMaintenanceEvent.camera_id,
                CameraMaintenanceEvent.event_date,
                CameraMaintenanceEvent.action_types,
            )
        ).all()
        with open(out / "maintenance_events.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["camera_id", "event_date", "action_types"])
            for m in maint:
                if m.camera_id in camera_ids:
                    w.writerow([m.camera_id, m.event_date, ";".join(m.action_types)])

        logger.info("Loading live images")
        image_rows = session.execute(
            _camera_filter(
                select(
                    Image.id.label("image_id"), Image.uuid, Image.camera_id,
                    Image.deployment_id, Image.captured_at, Image.ingested_at,
                    Image.thumbnail_path, Image.image_metadata,
                ).where(Image.origin == "live"),
                args.project_id,
            ).order_by(Image.camera_id, Image.ingested_at)
        ).all()

        by_camera: dict[int, list[Any]] = defaultdict(list)
        for r in image_rows:
            by_camera[r.camera_id].append(r)

        selected: dict[int, str] = {}
        for camera_id, rows in by_camera.items():
            picked = _select_thumbnails(
                rows, event_days.get(camera_id, set()),
                args.window_days, args.max_per_camera,
            )
            for r in rows:
                if r.image_id in picked:
                    selected[r.image_id] = r.thumbnail_path
        logger.info(
            "Image selection done",
            total_images=len(image_rows),
            cameras=len(by_camera),
            thumbnails_selected=len(selected),
        )

        meta_by_image: dict[int, Optional[dict[str, Any]]] = {}
        with open(out / "images.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow([
                "image_id", "uuid", "camera_id", "deployment_id", "captured_at",
                "ingested_at", "width", "height", "thumb_exported",
            ])
            for r in image_rows:
                meta = r.image_metadata if isinstance(r.image_metadata, dict) else None
                meta_by_image[r.image_id] = meta
                w.writerow([
                    r.image_id, r.uuid, r.camera_id, r.deployment_id or "",
                    r.captured_at.isoformat(), r.ingested_at.isoformat(),
                    (meta or {}).get("width") or "", (meta or {}).get("height") or "",
                    int(r.image_id in selected),
                ])

        logger.info("Loading detections")
        detection_rows = session.execute(
            select(
                Detection.image_id, Detection.category, Detection.confidence,
                Detection.bbox,
            )
            .join(Image, Image.id == Detection.image_id)
            .where(Image.origin == "live")
        ).all()
        with open(out / "detections.csv", "w", newline="") as f:
            w = csv.writer(f)
            w.writerow([
                "image_id", "category", "confidence",
                "bbox_x", "bbox_y", "bbox_w", "bbox_h", "bbox_area_frac",
            ])
            written = 0
            for d in detection_rows:
                if d.image_id not in meta_by_image:
                    continue
                x, y, bw, bh = _bbox_norm(d.bbox or {}, meta_by_image[d.image_id])
                area = bw * bh if bw is not None and bh is not None else None
                w.writerow([
                    d.image_id, d.category or "", round(d.confidence, 4),
                    _round(x), _round(y), _round(bw), _round(bh), _round(area),
                ])
                written += 1
        logger.info("Detections written", count=written)

    storage = StorageClient()
    failures = 0
    done = 0
    total = len(selected)
    logger.info("Downloading thumbnails", count=total)

    def fetch(image_id: int, key: str) -> None:
        data = storage.download_fileobj(BUCKET_THUMBNAILS, key)
        (thumbs_dir / f"{image_id}.jpg").write_bytes(data)

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        futures = {
            pool.submit(fetch, image_id, key): image_id
            for image_id, key in selected.items()
        }
        for fut in as_completed(futures):
            done += 1
            try:
                fut.result()
            except ClientError as exc:
                failures += 1
                logger.error(
                    "Thumbnail download failed",
                    image_id=futures[fut],
                    error=str(exc),
                )
            if done % 500 == 0 or done == total:
                logger.info("Download progress", done=done, total=total, failed=failures)

    logger.info(
        "Export complete",
        output=str(out),
        thumbnails=total - failures,
        failed=failures,
    )
    return 0 if failures == 0 else 1


def _round(value: Optional[float]) -> Any:
    return round(value, 5) if value is not None else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--project-id", type=int, default=None,
        help="limit to one project (default: all projects)",
    )
    common.add_argument(
        "--max-per-camera", type=int, default=1500,
        help="thumbnail budget per camera outside event windows (default 1500)",
    )

    sub.add_parser("scope", parents=[common], help="print counts, export nothing")

    export = sub.add_parser("export", parents=[common], help="write CSVs and thumbnails")
    export.add_argument(
        "--output", default="/app/bakeoff-export",
        help="output directory inside the container (default /app/bakeoff-export)",
    )
    export.add_argument(
        "--window-days", type=int, default=7,
        help="always export thumbnails this many days around a ground-truth event (default 7)",
    )

    args = parser.parse_args()
    if args.command == "scope":
        return cmd_scope(args)
    return cmd_export(args)


if __name__ == "__main__":
    sys.exit(main())
