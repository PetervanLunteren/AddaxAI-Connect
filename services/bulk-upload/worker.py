"""
Bulk-upload worker

Consumes one job at a time from `bulk-upload-job`. Each job points at a
ZIP staged in MinIO bucket `bulk-upload-staging`. The worker streams
the ZIP, iterates entries, and feeds each image into the same pipeline
as live FTPS ingestion via the bulk-priority queues.

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
from datetime import datetime, timezone

# Vendored copy of the live ingestion service. Same Python module path
# as ingestion uses internally so the imports below work unchanged.
sys.path.insert(0, "/ingestion_lib")

from sqlalchemy import select

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


def process_job(message: dict) -> None:
    """Drain one BulkUploadJob end-to-end."""
    job_uuid = message.get("job_uuid")
    if not job_uuid:
        logger.error("Bulk upload message missing job_uuid", message=message)
        return

    storage = StorageClient()

    # Snapshot the job + camera, then close the session so the long
    # extraction loop doesn't hold a connection open.
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
        job.status = "extracting"
        job.started_at = datetime.now(timezone.utc)

    logger.info(
        "Starting bulk upload job",
        job_uuid=job_uuid,
        camera_id=camera_id,
        staged_object_key=staged_object_key,
    )

    tmp_zip_handle, tmp_zip_path = tempfile.mkstemp(suffix=".zip")
    os.close(tmp_zip_handle)

    try:
        zip_bytes = storage.download_fileobj(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
        with open(tmp_zip_path, "wb") as fh:
            fh.write(zip_bytes)

        with zipfile.ZipFile(tmp_zip_path) as zf:
            entries = [info for info in zf.infolist() if not info.is_dir()]
            _set_status(job_uuid, total_files=len(entries), status="processing")

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

        # Worker is done unpacking. The job stays in 'processing' until
        # detection + classification finish for every image it produced.
        # The API derives done-ness from the count of bulk-job images
        # that reached status='classified'.
        _set_status(job_uuid, skipped_files=skipped, status="processing")

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
            "Bulk upload job failed",
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
        # Do not re-raise. The worker should keep draining the next job.

    finally:
        try:
            os.unlink(tmp_zip_path)
        except OSError:
            pass


def main() -> None:
    logger.info("Bulk upload worker starting")
    queue = RedisQueue(QUEUE_BULK_UPLOAD_JOB)
    queue.consume_forever(process_job)


if __name__ == "__main__":
    main()
