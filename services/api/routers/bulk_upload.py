"""
Bulk image upload endpoints

Project-admin-only. The client scans the user's folder locally, picks a
camera, then POSTs one file at a time to a job's staging prefix. Once
every file is in MinIO the client calls /finalize, which flips the job
to 'processing' and publishes to the bulk-upload worker.

Status flow:
    uploading -> processing -> done | failed

Legacy jobs created before the per-file refactor (statuses queued,
inspecting, awaiting_confirmation) are still readable but cannot be
resumed; they expire via the orphan-cleanup pass.
"""
import csv
import io
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import BulkUploadJob, Camera, Image, User
from shared.queue import QUEUE_BULK_UPLOAD_JOB_PROCESS, RedisQueue
from shared.storage import BUCKET_BULK_UPLOAD_STAGING, StorageClient
from auth.permissions import require_project_admin_access

router = APIRouter(
    prefix="/api/projects/{project_id}/bulk-upload",
    tags=["bulk-upload"],
)
logger = get_logger("api.bulk_upload")

# Per-file and per-job caps. 50 MB covers any realistic single trail-cam
# frame with headroom. 5000 files matches the per-job cap users see in
# the modal (one SD card per job).
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
MAX_FILES_PER_JOB = 5000
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
ALLOWED_EXTENSIONS = (".jpg", ".jpeg", ".png")

# Jobs that have been accepting uploads for longer than this without a
# finalize call get auto-failed and their staged objects deleted. Covers
# the case of a user closing the tab mid-upload. 24 h is generous enough
# that a slow upload over a bad connection still has time to finish.
UPLOAD_TTL = timedelta(hours=24)


class BulkUploadJobResponse(BaseModel):
    """One bulk-upload job row, as returned to the frontend."""
    uuid: str
    project_id: int
    camera_id: Optional[int]
    camera_name: Optional[str]
    original_filename: str
    status: str
    total_files: int
    processed_files: int
    skipped_files: int
    error_message: Optional[str]
    manifest: Optional[Dict[str, Any]] = None
    queue_position: Optional[int] = None
    started_at: Optional[str]
    process_started_at: Optional[str] = None
    finished_at: Optional[str]
    created_at: str
    created_by_email: Optional[str]


class CreateBulkUploadRequest(BaseModel):
    """Create an empty bulk-upload job. Files are uploaded separately."""
    folder_name: str = Field(min_length=1, max_length=255)
    camera_id: int
    total_files: int = Field(ge=1, le=MAX_FILES_PER_JOB)
    # Free-form client-computed scan summary. Stored on the job and shown
    # back in the review UI. See the bulk-upload worker for the shape.
    manifest: Dict[str, Any] = Field(default_factory=dict)


class ScanSuggestRequest(BaseModel):
    """Match EXIF SerialNumbers from the client scan against cameras."""
    serial_counts: Dict[str, int] = Field(default_factory=dict)


class ScanSuggestResponse(BaseModel):
    matched_cameras: List[Dict[str, Any]]
    suggested_camera: Optional[Dict[str, Any]] = None


class CheckDuplicatesRequest(BaseModel):
    """
    Fingerprint check: for the picked camera, how many Image rows
    exist at each of these naive EXIF timestamps? Cheap alternative
    to content-hash dedup, one indexed lookup on Image.captured_at.
    """
    camera_id: int
    captured_ats: List[str] = Field(default_factory=list)


class CheckDuplicatesResponse(BaseModel):
    # captured_at iso -> count of matching Image rows on that camera.
    # The client uses the count to decide whether a skip is safe: a
    # single match against a single scan entry is unambiguous, but
    # multi-match (burst mode) is ambiguous and must be sent through
    # so the server's content-hash dedup can sort it out.
    duplicate_counts: Dict[str, int]


def _staging_prefix(project_id: int, job_uuid: str) -> str:
    """MinIO key prefix that holds every file for one bulk-upload job."""
    return f"{project_id}/{job_uuid}/"


def _safe_basename(name: str) -> str:
    """Strip directory components and replace unsafe chars."""
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_")
    return cleaned or "image.jpg"


async def _pipeline_done_counts(
    db: AsyncSession, job_ids: List[int]
) -> Dict[int, int]:
    """Count classified+failed images per bulk-upload job."""
    if not job_ids:
        return {}
    rows = (
        await db.execute(
            select(Image.bulk_upload_job_id, func.count(Image.id))
            .where(
                Image.bulk_upload_job_id.in_(job_ids),
                Image.status.in_(("classified", "failed")),
            )
            .group_by(Image.bulk_upload_job_id)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def _finalise_done_jobs(
    db: AsyncSession, jobs: List[BulkUploadJob], processed_counts: Dict[int, int]
) -> None:
    """Flip 'processing' jobs to 'done' once every queued image is finished."""
    finished_ids: List[int] = []
    for job in jobs:
        if job.status != "processing":
            continue
        processed = processed_counts.get(job.id, 0)
        if processed + job.skipped_files >= job.total_files:
            finished_ids.append(job.id)
    if not finished_ids:
        return
    now = datetime.now(timezone.utc)
    await db.execute(
        update(BulkUploadJob)
        .where(BulkUploadJob.id.in_(finished_ids))
        .values(status="done", finished_at=now)
    )
    await db.commit()
    for job in jobs:
        if job.id in finished_ids:
            job.status = "done"
            job.finished_at = now


def _delete_staging(staged_object_key: str) -> None:
    """
    Delete the MinIO state for a job. Handles both the new per-file
    prefix layout (key ends with '/') and the legacy single-ZIP layout.
    """
    if not staged_object_key:
        return
    storage = StorageClient()
    try:
        if staged_object_key.endswith("/"):
            for key in storage.list_objects(BUCKET_BULK_UPLOAD_STAGING, staged_object_key):
                try:
                    storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, key)
                except Exception as exc:
                    logger.warning(
                        "Failed to delete staged file",
                        key=key,
                        error=str(exc),
                    )
        else:
            storage.delete_object(BUCKET_BULK_UPLOAD_STAGING, staged_object_key)
    except Exception as exc:
        logger.warning(
            "Failed to clean staging",
            staged_object_key=staged_object_key,
            error=str(exc),
        )


async def _expire_orphan_jobs(db: AsyncSession, project_id: int) -> None:
    """
    Fail jobs stuck in a pre-processing state past UPLOAD_TTL and clean
    their staging. Covers both the new 'uploading' state and the legacy
    inspect/awaiting_confirmation states from before the refactor.
    """
    cutoff = datetime.now(timezone.utc) - UPLOAD_TTL
    pre_processing = ("uploading", "queued", "inspecting", "awaiting_confirmation")
    orphans = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.status.in_(pre_processing),
                BulkUploadJob.created_at < cutoff,
            )
        )
    ).scalars().all()
    if not orphans:
        return
    now = datetime.now(timezone.utc)
    for job in orphans:
        _delete_staging(job.staged_object_key)
        job.status = "failed"
        job.error_message = "Auto-cancelled after 24 hours waiting on upload"
        job.finished_at = now
    await db.commit()


async def _queue_positions(db: AsyncSession, project_id: int) -> Dict[int, int]:
    """
    Map of bulk_upload_job.id -> jobs-ahead-in-the-worker-queue, for
    jobs the worker has not finished yet. Position 0 means next to run.
    Only meaningful for status='processing'.
    """
    rows = (
        await db.execute(
            select(BulkUploadJob.id)
            .where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.status == "processing",
            )
            .order_by(BulkUploadJob.id.asc())
        )
    ).all()
    return {row[0]: idx for idx, row in enumerate(rows)}


def _job_to_response(
    job: BulkUploadJob,
    camera_name: Optional[str],
    created_by_email: Optional[str],
    processed_files: int,
    queue_position: Optional[int] = None,
) -> BulkUploadJobResponse:
    return BulkUploadJobResponse(
        uuid=job.uuid,
        project_id=job.project_id,
        camera_id=job.camera_id,
        camera_name=camera_name,
        original_filename=job.original_filename,
        status=job.status,
        total_files=job.total_files,
        processed_files=processed_files,
        skipped_files=job.skipped_files,
        error_message=job.error_message,
        manifest=job.manifest,
        queue_position=queue_position if job.status == "processing" else None,
        started_at=job.started_at.isoformat() if job.started_at else None,
        process_started_at=(
            job.process_started_at.isoformat() if job.process_started_at else None
        ),
        finished_at=job.finished_at.isoformat() if job.finished_at else None,
        created_at=job.created_at.isoformat() if job.created_at else "",
        created_by_email=created_by_email,
    )


@router.post("/scan-suggest", response_model=ScanSuggestResponse)
async def scan_suggest(
    project_id: int,
    body: ScanSuggestRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Given the EXIF SerialNumber counts the client read locally, return
    the matched cameras in this project. Used by the pre-flight scan
    UI to suggest a camera before any byte crosses the network.
    """
    if not body.serial_counts:
        return ScanSuggestResponse(matched_cameras=[], suggested_camera=None)

    rows = (
        await db.execute(
            select(Camera.id, Camera.name, Camera.device_id).where(
                Camera.project_id == project_id,
                Camera.device_id.in_(list(body.serial_counts.keys())),
            )
        )
    ).all()

    matched: List[Dict[str, Any]] = []
    for cam_id, cam_name, device_id in rows:
        count = body.serial_counts.get(device_id, 0)
        if count <= 0:
            continue
        matched.append({
            "camera_id": cam_id,
            "camera_name": cam_name,
            "device_id": device_id,
            "match_count": count,
        })
    matched.sort(key=lambda c: c["match_count"], reverse=True)

    # Auto-suggest only when one camera dominates. Treat a one-image
    # match as noise (an EXIF coincidence) so we never auto-pick the
    # wrong camera on a near-miss.
    suggested: Optional[Dict[str, Any]] = None
    total_serial_count = sum(body.serial_counts.values())
    if matched and matched[0]["match_count"] >= 2:
        top = matched[0]
        if total_serial_count > 0 and top["match_count"] / total_serial_count >= 0.5:
            suggested = top

    return ScanSuggestResponse(matched_cameras=matched, suggested_camera=suggested)


@router.post("/check-duplicates", response_model=CheckDuplicatesResponse)
async def check_duplicates(
    project_id: int,
    body: CheckDuplicatesRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    For the picked camera, return the naive EXIF timestamps that
    already exist on an Image row. Used by the pre-flight scan to
    show "N already in the project" before the user pays the upload
    cost. Camera-scoped so two cameras firing at the same second do
    not produce a false positive across cameras.
    """
    if not body.captured_ats:
        return CheckDuplicatesResponse(duplicate_counts={})

    # Verify the camera belongs to this project, otherwise this is a
    # cross-project query attempt.
    cam = (
        await db.execute(
            select(Camera.id).where(
                Camera.id == body.camera_id,
                Camera.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if cam is None:
        raise HTTPException(
            status_code=400,
            detail="Camera does not belong to this project",
        )

    # Parse the client's naive ISO strings into Python naive
    # datetimes. captured_at is stored without tzinfo per the
    # camera-clock rule in DEVELOPERS.md, so the comparison must use
    # naive values as well; passing aware datetimes would crash the
    # query with a tz-mismatch error.
    parsed: List[datetime] = []
    for value in body.captured_ats:
        try:
            dt = datetime.fromisoformat(value)
        except ValueError:
            continue
        if dt.tzinfo is not None:
            # Drop the tz; everything in this column is camera-clock
            # naive. The client should not send an offset here.
            dt = dt.replace(tzinfo=None)
        parsed.append(dt)
    if not parsed:
        return CheckDuplicatesResponse(duplicate_counts={})

    rows = await db.execute(
        select(Image.captured_at, func.count(Image.id))
        .where(
            Image.camera_id == body.camera_id,
            Image.captured_at.in_(parsed),
        )
        .group_by(Image.captured_at)
    )
    counts: Dict[str, int] = {}
    for dt, n in rows.all():
        if dt is None:
            continue
        # Echo back in the ISO shape the client sent so the frontend
        # can build a Map without timezone gymnastics.
        counts[dt.strftime("%Y-%m-%dT%H:%M:%S")] = int(n)
    return CheckDuplicatesResponse(duplicate_counts=counts)


@router.post("/jobs", status_code=status.HTTP_201_CREATED, response_model=BulkUploadJobResponse)
async def create_bulk_upload_job(
    project_id: int,
    body: CreateBulkUploadRequest,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Create an empty bulk-upload job. The frontend has already scanned
    the user's folder, picked a camera, and computed the manifest. Now
    it uploads files one at a time to /jobs/{uuid}/files and finishes
    with /jobs/{uuid}/finalize.
    """
    camera = (
        await db.execute(
            select(Camera).where(
                Camera.id == body.camera_id,
                Camera.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if camera is None:
        raise HTTPException(
            status_code=400,
            detail="Camera does not belong to this project",
        )

    job_uuid = str(uuid.uuid4())
    safe_folder_name = _safe_basename(body.folder_name) or "upload"

    job = BulkUploadJob(
        uuid=job_uuid,
        project_id=project_id,
        created_by_user_id=user.id,
        camera_id=camera.id,
        original_filename=safe_folder_name,
        staged_object_key=_staging_prefix(project_id, job_uuid),
        status="uploading",
        total_files=body.total_files,
        manifest=body.manifest or None,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    logger.info(
        "Created bulk upload job",
        job_uuid=job_uuid,
        project_id=project_id,
        camera_id=camera.id,
        total_files=body.total_files,
        user_id=user.id,
    )

    return _job_to_response(
        job,
        camera_name=camera.name,
        created_by_email=user.email,
        processed_files=0,
    )


@router.post("/jobs/{job_uuid}/files", status_code=status.HTTP_201_CREATED)
async def upload_bulk_file(
    project_id: int,
    job_uuid: str,
    index: int,
    file: UploadFile = File(...),
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Upload one file into a job's staging prefix. The client passes its
    own ordering index so retries write to the same MinIO key (idempotent
    for slice B resume).
    """
    if index < 0 or index >= MAX_FILES_PER_JOB:
        raise HTTPException(status_code=400, detail="File index out of range")

    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")
    if job.status != "uploading":
        raise HTTPException(
            status_code=400,
            detail=f"Job is in status '{job.status}', cannot accept more files",
        )

    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail="Only JPEG and PNG images are supported",
        )
    # Content-type is set by the browser; tolerate octet-stream fallback
    # (Firefox does this for some drag-drop paths) when the extension
    # already vouched for the type.
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        if file.content_type != "application/octet-stream":
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported content type {file.content_type}",
            )

    body = await file.read()
    if len(body) == 0:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(body) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB cap",
        )

    safe_name = _safe_basename(file.filename)
    object_key = f"{_staging_prefix(project_id, job_uuid)}{index:06d}_{safe_name}"

    storage = StorageClient()
    storage.upload_fileobj(io.BytesIO(body), BUCKET_BULK_UPLOAD_STAGING, object_key)

    return {"object_key": object_key, "size": len(body)}


@router.post("/jobs/{job_uuid}/finalize", response_model=BulkUploadJobResponse)
async def finalize_bulk_upload(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Mark a job as finished uploading and hand it to the worker. The
    client calls this once every per-file POST has returned 2xx.
    """
    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")
    if job.status != "uploading":
        raise HTTPException(
            status_code=400,
            detail=f"Job is in status '{job.status}', cannot finalize",
        )
    if job.camera_id is None:
        raise HTTPException(
            status_code=400,
            detail="Job has no target camera",
        )

    job.status = "processing"
    job.started_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)

    queue = RedisQueue(QUEUE_BULK_UPLOAD_JOB_PROCESS)
    queue.publish({"job_uuid": job_uuid, "phase": "process"})

    camera_name = (
        await db.execute(select(Camera.name).where(Camera.id == job.camera_id))
    ).scalar_one_or_none()

    logger.info(
        "Bulk upload finalized",
        job_uuid=job_uuid,
        camera_id=job.camera_id,
        total_files=job.total_files,
        user_id=user.id,
    )
    return _job_to_response(
        job,
        camera_name=camera_name,
        created_by_email=user.email,
        processed_files=0,
    )


@router.post("/jobs/{job_uuid}/cancel", response_model=BulkUploadJobResponse)
async def cancel_bulk_upload(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Cancel an in-flight upload. Deletes staging and marks the job
    failed. Refuses once processing has started, because the worker
    is mid-pipeline.
    """
    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")
    cancellable = ("uploading", "queued", "inspecting", "awaiting_confirmation")
    if job.status not in cancellable:
        raise HTTPException(
            status_code=400,
            detail=f"Job is in status '{job.status}', cannot cancel",
        )

    _delete_staging(job.staged_object_key)

    job.status = "failed"
    job.error_message = "Cancelled by user"
    job.finished_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)

    camera_name = None
    if job.camera_id:
        camera_name = (
            await db.execute(select(Camera.name).where(Camera.id == job.camera_id))
        ).scalar_one_or_none()

    return _job_to_response(
        job,
        camera_name=camera_name,
        created_by_email=user.email,
        processed_files=0,
    )


@router.delete("/jobs/{job_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_bulk_upload_job(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Remove a bulk-upload job from the list. Cleans staging for any
    pre-processing state. Refuses while the worker is mid-pipeline so
    we don't leak half-deleted state.
    """
    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")
    if job.status == "processing":
        raise HTTPException(
            status_code=400,
            detail="Cannot discard a job that is currently processing",
        )

    pre_processing = ("uploading", "queued", "inspecting", "awaiting_confirmation")
    if job.status in pre_processing:
        _delete_staging(job.staged_object_key)

    await db.delete(job)
    await db.commit()
    logger.info(
        "Discarded bulk upload job",
        job_uuid=job_uuid,
        prior_status=job.status,
        user_id=user.id,
    )


@router.get("/jobs", response_model=List[BulkUploadJobResponse])
async def list_bulk_upload_jobs(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """List bulk-upload jobs for this project, most recent first."""
    await _expire_orphan_jobs(db, project_id)
    rows = (
        await db.execute(
            select(BulkUploadJob, Camera.name, User.email)
            .outerjoin(Camera, BulkUploadJob.camera_id == Camera.id)
            .join(User, BulkUploadJob.created_by_user_id == User.id)
            .where(BulkUploadJob.project_id == project_id)
            .order_by(BulkUploadJob.created_at.desc())
            .limit(100)
        )
    ).all()
    jobs = [job for job, _, _ in rows]
    processed_counts = await _pipeline_done_counts(db, [j.id for j in jobs])
    await _finalise_done_jobs(db, jobs, processed_counts)
    positions = await _queue_positions(db, project_id)
    return [
        _job_to_response(
            job,
            camera_name=cam_name,
            created_by_email=email,
            processed_files=processed_counts.get(job.id, 0),
            queue_position=positions.get(job.id),
        )
        for job, cam_name, email in rows
    ]


@router.get("/jobs/{job_uuid}/uploaded-indexes")
async def get_uploaded_indexes(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Return the list of file indexes already in the job's staging
    prefix. The client uses this on resume to skip files that landed
    before the previous tab closed.
    """
    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")
    if job.status != "uploading":
        raise HTTPException(
            status_code=400,
            detail=f"Job is in status '{job.status}', cannot list staged uploads",
        )
    if not job.staged_object_key or not job.staged_object_key.endswith("/"):
        # Legacy single-zip job, has no per-file indexes by design.
        return {"indexes": []}

    storage = StorageClient()
    indexes: List[int] = []
    for key in storage.list_objects(BUCKET_BULK_UPLOAD_STAGING, job.staged_object_key):
        tail = key.rsplit("/", 1)[-1]
        prefix = tail.split("_", 1)[0] if "_" in tail else tail
        try:
            indexes.append(int(prefix))
        except ValueError:
            continue
    indexes.sort()
    return {"indexes": indexes}


@router.get("/jobs/{job_uuid}/log.csv")
async def get_bulk_upload_log(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Stream a per-file CSV log of what happened to every file in this
    job. One row per source file, columns filename, outcome, reason,
    image_uuid, existing_uuid. Built from the manifest.file_log the
    worker writes at the end of processing; empty rows result when
    the job is still running or never finished.
    """
    job = (
        await db.execute(
            select(BulkUploadJob).where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Bulk upload job not found")

    rows: List[Dict[str, Any]] = []
    manifest = job.manifest or {}
    for entry in manifest.get("file_log") or []:
        rows.append({
            "filename": entry.get("filename", ""),
            "outcome": entry.get("outcome", ""),
            "reason": entry.get("reason", ""),
            "image_uuid": entry.get("image_uuid", ""),
            "existing_uuid": entry.get("existing_uuid", ""),
        })

    def stream() -> Any:
        buf = io.StringIO()
        writer = csv.DictWriter(
            buf,
            fieldnames=["filename", "outcome", "reason", "image_uuid", "existing_uuid"],
        )
        writer.writeheader()
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
        for row in rows:
            writer.writerow(row)
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)

    download_name = f"bulk-upload-{job_uuid[:8]}.csv"
    return StreamingResponse(
        stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


@router.get("/jobs/{job_uuid}", response_model=BulkUploadJobResponse)
async def get_bulk_upload_job(
    project_id: int,
    job_uuid: str,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """Single job, used by the frontend for live progress polling."""
    row = (
        await db.execute(
            select(BulkUploadJob, Camera.name, User.email)
            .outerjoin(Camera, BulkUploadJob.camera_id == Camera.id)
            .join(User, BulkUploadJob.created_by_user_id == User.id)
            .where(
                BulkUploadJob.project_id == project_id,
                BulkUploadJob.uuid == job_uuid,
            )
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Bulk upload job not found",
        )
    job, cam_name, email = row
    processed_counts = await _pipeline_done_counts(db, [job.id])
    await _finalise_done_jobs(db, [job], processed_counts)
    positions = await _queue_positions(db, project_id)
    return _job_to_response(
        job,
        camera_name=cam_name,
        created_by_email=email,
        processed_files=processed_counts.get(job.id, 0),
        queue_position=positions.get(job.id),
    )
