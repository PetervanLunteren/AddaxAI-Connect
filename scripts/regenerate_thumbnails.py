#!/usr/bin/env python3
"""
Regenerate missing thumbnails from raw images.

For every image row whose thumbnail_path points at an object that is missing
from the `thumbnails` bucket, downloads the raw from `raw-images`, resizes to
300 px wide JPEG q85 (same params as the ingestion service), and uploads to
`thumbnails` under the original key. Per-image errors are logged and skipped
so one bad raw does not abort the run.

Run from inside the api container, where shared, boto3, Pillow, and the env
vars are already wired up:

    docker compose exec api python /app/scripts/regenerate_thumbnails.py
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO

from botocore.exceptions import ClientError
from PIL import Image
from sqlalchemy import select

from shared.database import get_sync_session
from shared.logger import get_logger
from shared.models import Image as ImageRow
from shared.storage import BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS, StorageClient

logger = get_logger("regenerate-thumbnails")

THUMBNAIL_WIDTH = 300
JPEG_QUALITY = 85
WORKERS = 8


def thumbnail_exists(storage: StorageClient, key: str) -> bool:
    try:
        storage.client.head_object(Bucket=BUCKET_THUMBNAILS, Key=key)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def regenerate_one(storage: StorageClient, raw_key: str, thumb_key: str) -> None:
    raw_bytes = storage.download_fileobj(BUCKET_RAW_IMAGES, raw_key)
    with Image.open(BytesIO(raw_bytes)) as img:
        if img.mode != "RGB":
            img = img.convert("RGB")
        aspect = img.height / img.width
        new_size = (THUMBNAIL_WIDTH, int(THUMBNAIL_WIDTH * aspect))
        thumb = img.resize(new_size, Image.Resampling.LANCZOS)
    buf = BytesIO()
    thumb.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    buf.seek(0)
    storage.upload_fileobj(buf, BUCKET_THUMBNAILS, thumb_key)


def collect_missing(storage: StorageClient) -> list[tuple[str, str]]:
    with get_sync_session() as session:
        rows = session.execute(
            select(ImageRow.storage_path, ImageRow.thumbnail_path).where(
                ImageRow.thumbnail_path.isnot(None),
                ImageRow.storage_path.isnot(None),
            )
        ).all()

    logger.info("Scanning for missing thumbnails", total_rows=len(rows))
    missing: list[tuple[str, str]] = []
    for index, (storage_path, thumb_path) in enumerate(rows, start=1):
        if not thumbnail_exists(storage, thumb_path):
            missing.append((storage_path, thumb_path))
        if index % 1000 == 0:
            logger.info("Scan progress", scanned=index, missing=len(missing))
    return missing


def main() -> int:
    storage = StorageClient()
    missing = collect_missing(storage)
    total = len(missing)
    logger.info("Missing thumbnails to regenerate", count=total)
    if not total:
        return 0

    failures = 0
    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(regenerate_one, storage, raw, thumb): (raw, thumb)
            for raw, thumb in missing
        }
        for fut in as_completed(futures):
            raw, thumb = futures[fut]
            done += 1
            try:
                fut.result()
            except Exception as exc:
                failures += 1
                logger.error(
                    "Failed to regenerate thumbnail",
                    raw_key=raw,
                    thumb_key=thumb,
                    error=str(exc),
                )
            if done % 100 == 0 or done == total:
                logger.info("Regen progress", done=done, total=total, failed=failures)

    logger.info(
        "Regeneration complete",
        regenerated=total - failures,
        failed=failures,
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
