"""
Bulk-upload worker

Two-phase per job, dispatched by the "phase" field on every queue
message:

- phase="inspect": stages ZIP, walks entries, builds a manifest of
  per-status counts, date range, and the auto-suggested camera (when
  EXIF SerialNumber maps cleanly to a registered camera in the
  project). Status moves: queued -> inspecting -> awaiting_confirmation.
- phase="process": the user has confirmed the camera. Iterate the
  staged ZIP a second time and feed each valid entry into the live
  pipeline via the bulk priority queues. Status moves:
  awaiting_confirmation -> processing -> done (lazily, on API read,
  once detection + classification finish).

Bulk-origin images carry origin='bulk' through every queue message.
That gates notification fan-out at the classification stage so an
SD-card import never fires species_detection alerts retroactively.
"""
import hashlib
import os
import sys
import tempfile
import uuid
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Optional

# Vendored copy of the live ingestion service. Same Python module path
# as ingestion uses internally so the imports below work unchanged.
sys.path.insert(0, "/ingestion_lib")

from PIL import Image as PILImage
from PIL.ExifTags import TAGS
from sqlalchemy import func, select

from shared.database import get_db_session
from shared.logger import get_logger, set_image_id
from shared.models import BulkUploadJob, Camera, Image
from shared.queue import (
    QUEUE_BULK_UPLOAD_JOB,
    QUEUE_IMAGE_INGESTED_BULK,
    RedisQueue,
)
from shared.storage import BUCKET_BULK_UPLOAD_STAGING, StorageClient

from db_operations import create_image_record  # noqa: E402
from exif_parser import extract_exif, get_datetime_original  # noqa: E402
from storage_operations import (  # noqa: E402
    generate_and_upload_thumbnail,
    upload_image_to_minio,
)
from validators import validate_image  # noqa: E402

PROGRESS_PERSIST_EVERY = 25
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png")
# Filesystem cruft that ends up inside ZIPs but isn't a real user file.
# macOS adds __MACOSX/._* shadow entries to every zip it creates; macOS
# and Windows both drop .DS_Store / Thumbs.db / desktop.ini turds. We
# drop these silently rather than counting them as "skipped", because
# the skipped count is meant to surface real user issues.
_NOISE_NAMES = {"__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini"}


def _is_noise_entry(name: str) -> bool:
    for part in name.split("/"):
        if part in _NOISE_NAMES or part.startswith("._"):
            return True
    return False


def _read_exif_fast(path: str) -> dict:
    """
    In-process EXIF read for the inspect phase. Cheap (~5 ms/image)
    compared to spawning exiftool per file, which matters when we are
    inspecting 5,000 images live in a modal. The actual processing
    phase still uses the authoritative exiftool path from
    services/ingestion/exif_parser.py.
    """
    try:
        with PILImage.open(path) as img:
            raw = img._getexif() or {}
    except Exception:
        return {}
    return {TAGS.get(tag_id, str(tag_id)): value for tag_id, value in raw.items()}


def _parse_exif_datetime(value) -> Optional[datetime]:
    """Parse the EXIF DateTimeOriginal 'YYYY:MM:DD HH:MM:SS' format."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


logger = get_logger("bulk-upload")


def _set_status(job_uuid: str, **fields) -> None:
    """Update one BulkUploadJob row with the given fields."""
    with get_db_session() as session:
        job = session.execute(
            select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one()
        for key, value in fields.items():
            setattr(job, key, value)


def _camera_storage_id(camera: Camera) -> str:
    """
    Storage path uses the camera's `device_id` for live FTPS uploads to
    keep paths human-readable. Bulk uploads target a registered camera
    that may or may not have one; fall back to the DB id so the path
    stays unique either way.
    """
    if camera.device_id:
        return camera.device_id
    return f"camera-{camera.id}"


def _process_zip_entry(
    name: str,
    raw: bytes,
    camera_id: int,
    camera_storage_id: str,
    gps_location,
    bulk_queue: RedisQueue,
    bulk_upload_job_id: int,
) -> str:
    """
    Process a single ZIP entry end-to-end.

    Returns one of: 'processed', 'skipped'. Raises only on truly
    catastrophic failures; per-file issues become 'skipped' with a
    warning log so a single bad JPEG never sinks the whole batch.
    """
    if not name.lower().endswith(IMAGE_EXTENSIONS):
        return "skipped"

    content_hash = hashlib.sha256(raw).hexdigest()

    # Duplicate guard: same camera + same bytes was already imported.
    with get_db_session() as session:
        existing = session.execute(
            select(Image.uuid).where(
                Image.camera_id == camera_id,
                Image.content_hash == content_hash,
            ).limit(1)
        ).scalar_one_or_none()
        if existing:
            logger.info(
                "Skipping duplicate bulk upload entry",
                entry=name,
                existing_uuid=existing,
            )
            return "skipped"

    suffix = os.path.splitext(name)[1] or ".jpg"
    tmp_handle, tmp_path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(tmp_handle, "wb") as fh:
            fh.write(raw)

        # Validation matches the live FTPS path. Failure is per-file.
        try:
            validate_image(tmp_path)
        except Exception as exc:
            logger.warning(
                "Skipping bulk upload entry, validation failed",
                entry=name,
                error=str(exc),
            )
            return "skipped"

        exif = extract_exif(tmp_path)
        try:
            captured_at = get_datetime_original(exif, tmp_path, allow_fallback=False)
        except Exception as exc:
            logger.warning(
                "Skipping bulk upload entry, no DateTimeOriginal",
                entry=name,
                error=str(exc),
            )
            return "skipped"

        image_uuid = str(uuid.uuid4())
        clean_filename = os.path.basename(name)
        storage_path = upload_image_to_minio(
            tmp_path, camera_storage_id, image_uuid, clean_filename
        )
        try:
            thumbnail_path = generate_and_upload_thumbnail(
                tmp_path, camera_storage_id, image_uuid, clean_filename
            )
        except Exception as exc:
            logger.warning(
                "Failed to generate thumbnail for bulk image",
                entry=name,
                error=str(exc),
            )
            thumbnail_path = None

        create_image_record(
            image_uuid=image_uuid,
            camera_id=camera_id,
            filename=clean_filename,
            storage_path=storage_path,
            thumbnail_path=thumbnail_path,
            captured_at=captured_at,
            gps_location=gps_location,
            exif_metadata=exif,
            origin="bulk",
            content_hash=content_hash,
            bulk_upload_job_id=bulk_upload_job_id,
        )

        set_image_id(image_uuid)
        bulk_queue.publish({
            "image_uuid": image_uuid,
            "storage_path": storage_path,
            "camera_id": camera_id,
            "origin": "bulk",
        })

        return "processed"
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _download_staged_zip(storage: StorageClient, staged_object_key: str) -> str:
    """Stream the staged ZIP to a tmp file. Caller deletes the path."""
    tmp_handle, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(tmp_handle)
    zip_bytes = storage.download_fileobj(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
    with open(tmp_path, "wb") as fh:
        fh.write(zip_bytes)
    return tmp_path


def _inspect_job(job_uuid: str) -> None:
    """
    Walk the staged ZIP and build a manifest of per-status counts,
    date range, and the auto-suggested camera. Does not touch MinIO
    object storage and does not create any Image rows. Status moves
    queued -> inspecting -> awaiting_confirmation.
    """
    with get_db_session() as session:
        job = session.execute(
            select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one_or_none()
        if not job:
            logger.error("Bulk upload job not found", job_uuid=job_uuid)
            return
        project_id = job.project_id
        staged_object_key = job.staged_object_key
        job.status = "inspecting"
        job.started_at = datetime.now(timezone.utc)

    logger.info(
        "Inspecting bulk upload",
        job_uuid=job_uuid,
        project_id=project_id,
        staged_object_key=staged_object_key,
    )

    storage = StorageClient()
    tmp_zip_path: Optional[str] = None
    try:
        tmp_zip_path = _download_staged_zip(storage, staged_object_key)

        by_status: dict = defaultdict(int)
        serial_counts: Counter = Counter()
        min_dt: Optional[datetime] = None
        max_dt: Optional[datetime] = None
        valid_count = 0

        with zipfile.ZipFile(tmp_zip_path) as zf:
            entries = [
                info for info in zf.infolist()
                if not info.is_dir() and not _is_noise_entry(info.filename)
            ]
            total_entries = len(entries)

            for info in entries:
                tmp_path: Optional[str] = None
                try:
                    raw = zf.read(info)
                    suffix = os.path.splitext(info.filename)[1] or ".jpg"
                    tmp_handle, tmp_path = tempfile.mkstemp(suffix=suffix)
                    with os.fdopen(tmp_handle, "wb") as fh:
                        fh.write(raw)

                    exif = _read_exif_fast(tmp_path)
                    dt = _parse_exif_datetime(exif.get("DateTimeOriginal"))
                    if dt is None:
                        by_status["missing_exif_datetime"] += 1
                        continue

                    by_status["valid"] += 1
                    valid_count += 1
                    if min_dt is None or dt < min_dt:
                        min_dt = dt
                    if max_dt is None or dt > max_dt:
                        max_dt = dt
                    serial = exif.get("BodySerialNumber") or exif.get("SerialNumber")
                    if serial:
                        serial_counts[str(serial)] += 1
                except Exception as exc:
                    by_status["corrupt"] += 1
                    logger.warning(
                        "Inspect entry failed",
                        entry=info.filename,
                        error=str(exc),
                    )
                finally:
                    if tmp_path:
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass

        # Auto-suggest: at least 50% of valid entries must share one
        # EXIF SerialNumber and that serial must map to a registered
        # camera in this project. Less than 50% means the ZIP is mixed
        # or the camera isn't registered, so the user picks manually.
        suggested = None
        if valid_count > 0 and serial_counts:
            most_common_serial, match_count = serial_counts.most_common(1)[0]
            if match_count / valid_count >= 0.5:
                with get_db_session() as session:
                    camera = session.execute(
                        select(Camera).where(
                            Camera.project_id == project_id,
                            Camera.device_id == most_common_serial,
                        )
                    ).scalar_one_or_none()
                    if camera:
                        suggested = {
                            "camera_id": camera.id,
                            "camera_name": camera.name,
                            "device_id": camera.device_id,
                            "match_count": match_count,
                        }

        manifest = {
            "total_entries": total_entries,
            "valid_count": valid_count,
            "by_status": dict(by_status),
            "date_range": {
                "start": min_dt.isoformat() if min_dt else None,
                "end": max_dt.isoformat() if max_dt else None,
            },
            "suggested_camera": suggested,
        }

        _set_status(
            job_uuid,
            status="awaiting_confirmation",
            total_files=total_entries,
            manifest=manifest,
        )
        logger.info(
            "Inspection complete",
            job_uuid=job_uuid,
            total_entries=total_entries,
            valid_count=valid_count,
            by_status=dict(by_status),
            suggested_camera_id=suggested.get("camera_id") if suggested else None,
        )

    except Exception as exc:
        logger.error(
            "Bulk upload inspection failed",
            job_uuid=job_uuid,
            error=str(exc),
            exc_info=True,
        )
        _set_status(
            job_uuid,
            status="failed",
            error_message=f"Inspection failed: {exc}",
            finished_at=datetime.now(timezone.utc),
        )
    finally:
        if tmp_zip_path:
            try:
                os.unlink(tmp_zip_path)
            except OSError:
                pass


def _process_job(job_uuid: str) -> None:
    """
    Run the actual pipeline: iterate the staged ZIP, write each valid
    image into MinIO and the DB, publish to the bulk priority queue.
    Status moves awaiting_confirmation -> processing -> (lazily) done.
    """
    with get_db_session() as session:
        job = session.execute(
            select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one_or_none()
        if not job:
            logger.error("Bulk upload job not found", job_uuid=job_uuid)
            return
        camera = session.get(Camera, job.camera_id)
        if not camera:
            job.status = "failed"
            job.error_message = "Target camera no longer exists"
            job.finished_at = datetime.now(timezone.utc)
            return
        job_id = job.id
        camera_id = camera.id
        camera_storage_id = _camera_storage_id(camera)
        gps_location = None
        if camera.location:
            gps_location = (camera.location.coords[1], camera.location.coords[0])
        staged_object_key = job.staged_object_key
        job.status = "processing"

    logger.info(
        "Processing confirmed bulk upload",
        job_uuid=job_uuid,
        camera_id=camera_id,
        staged_object_key=staged_object_key,
    )

    storage = StorageClient()
    tmp_zip_path: Optional[str] = None
    try:
        tmp_zip_path = _download_staged_zip(storage, staged_object_key)

        with zipfile.ZipFile(tmp_zip_path) as zf:
            entries = [
                info for info in zf.infolist()
                if not info.is_dir() and not _is_noise_entry(info.filename)
            ]
            bulk_queue = RedisQueue(QUEUE_IMAGE_INGESTED_BULK)
            processed = 0
            skipped = 0

            for idx, info in enumerate(entries, start=1):
                try:
                    raw = zf.read(info)
                    outcome = _process_zip_entry(
                        info.filename,
                        raw,
                        camera_id,
                        camera_storage_id,
                        gps_location,
                        bulk_queue,
                        job_id,
                    )
                    if outcome == "processed":
                        processed += 1
                    else:
                        skipped += 1
                except Exception as exc:
                    logger.warning(
                        "Skipping bulk upload entry, unexpected error",
                        entry=info.filename,
                        error=str(exc),
                        exc_info=True,
                    )
                    skipped += 1

                if idx % PROGRESS_PERSIST_EVERY == 0:
                    _set_status(job_uuid, skipped_files=skipped)

        _set_status(job_uuid, skipped_files=skipped)

        try:
            storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
        except Exception as exc:
            logger.warning(
                "Failed to delete staged bulk upload zip",
                staged_object_key=staged_object_key,
                error=str(exc),
            )

        logger.info(
            "Finished unpacking bulk upload zip",
            job_uuid=job_uuid,
            queued_for_pipeline=processed,
            skipped=skipped,
        )

    except Exception as exc:
        logger.error(
            "Bulk upload processing failed",
            job_uuid=job_uuid,
            error=str(exc),
            exc_info=True,
        )
        _set_status(
            job_uuid,
            status="failed",
            error_message=str(exc),
            finished_at=datetime.now(timezone.utc),
        )

    finally:
        if tmp_zip_path:
            try:
                os.unlink(tmp_zip_path)
            except OSError:
                pass


def dispatch(message: dict) -> None:
    """Route a queue message to the inspect or process phase."""
    job_uuid = message.get("job_uuid")
    phase = message.get("phase", "inspect")
    if not job_uuid:
        logger.error("Bulk upload message missing job_uuid", message=message)
        return
    if phase == "inspect":
        _inspect_job(job_uuid)
    elif phase == "process":
        _process_job(job_uuid)
    else:
        logger.error("Unknown bulk upload phase", phase=phase, job_uuid=job_uuid)


def main() -> None:
    logger.info("Bulk upload worker starting")
    queue = RedisQueue(QUEUE_BULK_UPLOAD_JOB)
    queue.consume_forever(dispatch)


if __name__ == "__main__":
    main()
