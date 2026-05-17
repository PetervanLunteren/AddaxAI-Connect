"""
Bulk-upload worker

One message per job, phase="process", published by the API once the
client has finished uploading every file to the job's staging prefix.
The worker lists the prefix, ingests each object into the live
pipeline via the bulk priority queues, then deletes the staging. Status
moves uploading -> processing -> done (lazily, on API read, once
detection and classification finish).

Bulk-origin images carry origin='bulk' through every queue message.
That gates notification fan-out at the classification stage so an
SD-card import never fires species_detection alerts retroactively.

Legacy path: jobs created before the per-file refactor have a
staged_object_key ending in '.zip' and used a separate "inspect" phase.
That path is retained so any in-flight legacy job can drain after the
refactor lands. New jobs use the prefix layout.
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
    QUEUE_BULK_UPLOAD_JOB_PROCESS,
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

    Returns a dict with at least `outcome` in
    {'processed','duplicate','skipped'} and, when relevant, the
    `image_uuid` of the new image, the `existing_uuid` of the duplicate
    it matched, and a `reason` for skips. The log-CSV endpoint reads
    these straight back out of manifest.file_log. Per-file issues
    become outcome='skipped' with a warning log so a single bad JPEG
    never sinks the whole batch.
    """
    if not name.lower().endswith(IMAGE_EXTENSIONS):
        return {"outcome": "skipped", "reason": "unsupported_extension"}

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
            return {"outcome": "duplicate", "existing_uuid": existing}

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
            return {"outcome": "skipped", "reason": "validation_failed"}

        exif = extract_exif(tmp_path)
        try:
            captured_at = get_datetime_original(exif, tmp_path, allow_fallback=False)
        except Exception as exc:
            logger.warning(
                "Skipping bulk upload entry, no DateTimeOriginal",
                entry=name,
                error=str(exc),
            )
            return {"outcome": "skipped", "reason": "missing_datetime"}

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

        return {"outcome": "processed", "image_uuid": image_uuid}
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
        valid_hashes: list = []

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
                    valid_hashes.append(hashlib.sha256(raw).hexdigest())
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

        # Cross-check valid entries against images already in the
        # project. Project-wide check: identical bytes on two different
        # camera traps is essentially impossible, so a project-scoped
        # match is reliably a duplicate regardless of which camera the
        # user will eventually pick.
        if valid_hashes:
            with get_db_session() as session:
                existing_hashes = {
                    row[0] for row in session.execute(
                        select(Image.content_hash)
                        .join(Camera, Image.camera_id == Camera.id)
                        .where(
                            Camera.project_id == project_id,
                            Image.content_hash.in_(valid_hashes),
                        )
                    ).all()
                }
            if existing_hashes:
                # Note: a single hash could match multiple valid
                # entries (same image twice in the ZIP), but the count
                # we care about is "valid entries that are duplicates"
                # so we recount per entry.
                dup_count = sum(1 for h in valid_hashes if h in existing_hashes)
                by_status["duplicate"] = dup_count
                by_status["valid"] -= dup_count
                valid_count -= dup_count

        # Match every serial that appears against registered cameras
        # in this project. Each match keeps its count; we use the list
        # for both the auto-suggest (when there's a single dominant
        # camera) and the multi-camera refusal (when 2+ are matched).
        matched_cameras: list = []
        if serial_counts:
            with get_db_session() as session:
                # Select tuples instead of full Camera objects so the
                # values are plain Python by the time we use them.
                # Reading attributes off a Camera ORM instance after
                # the session closes triggers a refresh and crashes.
                rows = session.execute(
                    select(Camera.id, Camera.name, Camera.device_id).where(
                        Camera.project_id == project_id,
                        Camera.device_id.in_(list(serial_counts.keys())),
                    )
                ).all()
            for cam_id, cam_name, device_id in rows:
                match_count = serial_counts.get(device_id, 0)
                if match_count == 0:
                    continue
                matched_cameras.append({
                    "camera_id": cam_id,
                    "camera_name": cam_name,
                    "device_id": device_id,
                    "match_count": match_count,
                })
            matched_cameras.sort(key=lambda c: c["match_count"], reverse=True)

        # Cameras with only one stray match are treated as noise (an
        # accidental EXIF serial collision) so they don't trigger a
        # spurious "two cameras detected" refusal.
        significant_cameras = [c for c in matched_cameras if c["match_count"] >= 2]

        # Refuse multi-camera ZIPs: bulk upload attaches every image
        # to one camera_id. Without per-image routing (Slice 3) the
        # only safe option is to make the user split the batch.
        if len(significant_cameras) >= 2:
            names = ", ".join(
                f'{c["camera_name"]} ({c["match_count"]} images)'
                for c in significant_cameras
            )
            err = (
                f"ZIP spans {len(significant_cameras)} registered cameras: "
                f"{names}. Bulk upload handles one camera at a time. "
                "Split the ZIP per camera and retry."
            )
            logger.warning(
                "Refusing multi-camera bulk upload",
                job_uuid=job_uuid,
                matched_cameras=significant_cameras,
            )
            manifest = {
                "total_entries": total_entries,
                "valid_count": valid_count,
                "by_status": dict(by_status),
                "date_range": {
                    "start": min_dt.isoformat() if min_dt else None,
                    "end": max_dt.isoformat() if max_dt else None,
                },
                "suggested_camera": None,
                "matched_cameras": matched_cameras,
            }
            try:
                storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
            except Exception as exc:
                logger.warning(
                    "Failed to delete staged zip after multi-camera refusal",
                    error=str(exc),
                )
            _set_status(
                job_uuid,
                status="failed",
                error_message=err,
                manifest=manifest,
                total_files=total_entries,
                finished_at=datetime.now(timezone.utc),
            )
            return

        # Auto-suggest the single matched camera when it covers at
        # least 50% of valid entries. Less than 50% means a lot of
        # serials didn't match anything; safer to let the user pick.
        suggested = None
        if valid_count > 0 and matched_cameras:
            top = matched_cameras[0]
            if top["match_count"] / valid_count >= 0.5:
                suggested = top

        manifest = {
            "total_entries": total_entries,
            "valid_count": valid_count,
            "by_status": dict(by_status),
            "date_range": {
                "start": min_dt.isoformat() if min_dt else None,
                "end": max_dt.isoformat() if max_dt else None,
            },
            "suggested_camera": suggested,
            "matched_cameras": matched_cameras,
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


def _list_prefix(storage: StorageClient, prefix: str) -> list:
    """
    List every object under the job's staging prefix.

    Uses paginator-style calls so a 5000-file job is returned in full.
    The wrapper in shared/storage.py caps at a single page, which is
    fine for &lt; 1000 objects but truncates the rest. Drop to the boto3
    paginator for safety.
    """
    keys: list = []
    paginator = storage.client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET_BULK_UPLOAD_STAGING, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            keys.append(obj["Key"])
    return keys


def _process_prefix_job(
    job_uuid: str,
    job_id: int,
    camera_id: int,
    camera_storage_id: str,
    gps_location,
    staged_prefix: str,
) -> None:
    """
    Process a new-style per-file bulk-upload job. Lists MinIO under
    the job's staging prefix, downloads each file, runs the usual
    pipeline, deletes the staging.
    """
    storage = StorageClient()
    bulk_queue = RedisQueue(QUEUE_IMAGE_INGESTED_BULK)
    processed = 0
    duplicates = 0
    other_skipped = 0
    file_log: list = []

    object_keys = sorted(_list_prefix(storage, staged_prefix))
    logger.info(
        "Processing bulk upload prefix",
        job_uuid=job_uuid,
        staged_prefix=staged_prefix,
        object_count=len(object_keys),
    )

    for idx, key in enumerate(object_keys, start=1):
        # Object key shape: "{project_id}/{job_uuid}/{idx:06d}_{name}".
        # Recover the human filename for logs and storage paths.
        tail = key.rsplit("/", 1)[-1]
        filename = tail.split("_", 1)[1] if "_" in tail else tail
        try:
            raw = storage.download_fileobj(BUCKET_BULK_UPLOAD_STAGING, key)
            result = _process_zip_entry(
                filename,
                raw,
                camera_id,
                camera_storage_id,
                gps_location,
                bulk_queue,
                job_id,
            )
        except Exception as exc:
            logger.warning(
                "Skipping bulk upload object, unexpected error",
                object_key=key,
                error=str(exc),
                exc_info=True,
            )
            result = {"outcome": "skipped", "reason": "unexpected_error"}

        if result["outcome"] == "processed":
            processed += 1
        elif result["outcome"] == "duplicate":
            duplicates += 1
        else:
            other_skipped += 1

        file_log.append({
            "filename": filename,
            "object_key": key,
            **result,
        })

        # Best-effort cleanup as we go so a half-finished job does not
        # leave 5000 stale objects in MinIO.
        try:
            storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, key)
        except Exception as exc:
            logger.warning(
                "Failed to delete processed staging object",
                object_key=key,
                error=str(exc),
            )

        if idx % PROGRESS_PERSIST_EVERY == 0:
            _set_status(job_uuid, skipped_files=duplicates + other_skipped)

    # Stash the breakdown so the UI can say "all 30 were duplicates"
    # instead of "30 skipped". Per-file outcomes go alongside so the
    # log-CSV endpoint can stream them back without another scan.
    with get_db_session() as session:
        row = session.execute(
            select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one()
        manifest = dict(row.manifest or {})
        manifest["process_summary"] = {
            "queued_for_pipeline": processed,
            "duplicates": duplicates,
            "other_skipped": other_skipped,
        }
        manifest["file_log"] = file_log
        row.manifest = manifest
        row.skipped_files = duplicates + other_skipped

    logger.info(
        "Finished processing bulk upload prefix",
        job_uuid=job_uuid,
        queued_for_pipeline=processed,
        duplicates=duplicates,
        other_skipped=other_skipped,
    )


def _process_legacy_zip_job(
    job_uuid: str,
    job_id: int,
    camera_id: int,
    camera_storage_id: str,
    gps_location,
    staged_object_key: str,
) -> None:
    """
    Drain a pre-refactor bulk-upload job whose staged_object_key points
    at a single ZIP. Kept so anything created before the per-file
    rollout can still complete.
    """
    storage = StorageClient()
    tmp_zip_path: Optional[str] = None
    bulk_queue = RedisQueue(QUEUE_IMAGE_INGESTED_BULK)
    processed = 0
    duplicates = 0
    other_skipped = 0
    file_log: list = []
    try:
        tmp_zip_path = _download_staged_zip(storage, staged_object_key)
        with zipfile.ZipFile(tmp_zip_path) as zf:
            entries = [
                info for info in zf.infolist()
                if not info.is_dir() and not _is_noise_entry(info.filename)
            ]
            for idx, info in enumerate(entries, start=1):
                try:
                    raw = zf.read(info)
                    result = _process_zip_entry(
                        info.filename, raw, camera_id, camera_storage_id,
                        gps_location, bulk_queue, job_id,
                    )
                except Exception as exc:
                    logger.warning(
                        "Skipping legacy zip entry",
                        entry=info.filename, error=str(exc), exc_info=True,
                    )
                    result = {"outcome": "skipped", "reason": "unexpected_error"}

                if result["outcome"] == "processed":
                    processed += 1
                elif result["outcome"] == "duplicate":
                    duplicates += 1
                else:
                    other_skipped += 1
                file_log.append({
                    "filename": info.filename,
                    **result,
                })
                if idx % PROGRESS_PERSIST_EVERY == 0:
                    _set_status(job_uuid, skipped_files=duplicates + other_skipped)

        with get_db_session() as session:
            row = session.execute(
                select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
            ).scalar_one()
            manifest = dict(row.manifest or {})
            manifest["process_summary"] = {
                "queued_for_pipeline": processed,
                "duplicates": duplicates,
                "other_skipped": other_skipped,
            }
            manifest["file_log"] = file_log
            row.manifest = manifest
            row.skipped_files = duplicates + other_skipped

        try:
            storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
        except Exception as exc:
            logger.warning(
                "Failed to delete legacy staged zip",
                staged_object_key=staged_object_key, error=str(exc),
            )
    finally:
        if tmp_zip_path:
            try:
                os.unlink(tmp_zip_path)
            except OSError:
                pass


def _process_job(job_uuid: str) -> None:
    """
    Dispatcher for the process phase. Reads the job row, picks the
    per-file or legacy-zip path based on the staging key shape, runs
    the pipeline, marks status. Failure is captured at this level so
    no exception escapes to the queue consumer.
    """
    with get_db_session() as session:
        job = session.execute(
            select(BulkUploadJob).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one_or_none()
        if not job:
            logger.error("Bulk upload job not found", job_uuid=job_uuid)
            return
        camera = session.get(Camera, job.camera_id) if job.camera_id else None
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
        # The API flips status to 'processing' at finalize so users see
        # the right state during the brief queue hop; we still own
        # process_started_at since that drives the self-calibrating ETA.
        job.status = "processing"
        job.process_started_at = datetime.now(timezone.utc)

    is_prefix = staged_object_key.endswith("/")
    logger.info(
        "Processing bulk upload",
        job_uuid=job_uuid,
        camera_id=camera_id,
        staged_object_key=staged_object_key,
        layout="prefix" if is_prefix else "legacy_zip",
    )

    try:
        if is_prefix:
            _process_prefix_job(
                job_uuid, job_id, camera_id, camera_storage_id,
                gps_location, staged_object_key,
            )
        else:
            _process_legacy_zip_job(
                job_uuid, job_id, camera_id, camera_storage_id,
                gps_location, staged_object_key,
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
    # Process-phase messages take priority over inspect-phase so a
    # user clicking Process is never queued behind someone else's
    # pending ZIP inspection. Same pattern as live > bulk for the
    # detection / classification pipeline.
    queue = RedisQueue(QUEUE_BULK_UPLOAD_JOB)
    priority = [QUEUE_BULK_UPLOAD_JOB_PROCESS, QUEUE_BULK_UPLOAD_JOB]
    logger.info("Listening on priority queues", queues=priority)
    queue.consume_forever_priority(priority, dispatch)


if __name__ == "__main__":
    main()
