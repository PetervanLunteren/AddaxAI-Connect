"""
Bulk image upload endpoints

Project-admin-only. POST a ZIP scoped to one camera; the API stages it
in MinIO and queues a background job. The bulk-upload worker drains
jobs one at a time, feeding each entry into the live pipeline via the
bulk-priority queues so live cameras keep priority.
"""
import io
import re
import uuid
import zipfile
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from shared.database import get_async_session
from shared.logger import get_logger
from shared.models import BulkUploadJob, Camera, Image, User
from shared.queue import QUEUE_BULK_UPLOAD_JOB, RedisQueue
from shared.storage import BUCKET_BULK_UPLOAD_STAGING, StorageClient
from auth.permissions import require_project_admin_access

router = APIRouter(
    prefix="/api/projects/{project_id}/bulk-upload",
    tags=["bulk-upload"],
)
logger = get_logger("api.bulk_upload")

# Caps on a single ZIP to bound resource use on a small server.
# Mirrored in the worker (which also walks the entry list once).
MAX_ZIP_SIZE_BYTES = 20 * 1024 * 1024 * 1024  # 20 GB
MAX_ZIP_ENTRIES = 5000
# Filesystem cruft that ends up inside zipped folders but isn't a real
# file: macOS resource forks under __MACOSX/, plus the usual .DS_Store
# and Windows desktop turds. Filtered before counting so the 5000-entry
# cap and the user-visible total_files reflect actual images.
_NOISE_NAMES = {"__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini"}


def _is_noise_entry(name: str) -> bool:
    for part in name.split("/"):
        if part in _NOISE_NAMES or part.startswith("._"):
            return True
    return False


class BulkUploadJobResponse(BaseModel):
    """One bulk-upload job row, as returned to the frontend."""
    uuid: str
    project_id: int
    camera_id: int
    camera_name: Optional[str]
    original_filename: str
    status: str
    total_files: int
    processed_files: int
    skipped_files: int
    error_message: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    created_at: str
    created_by_email: Optional[str]


async def _pipeline_done_counts(
    db: AsyncSession, job_ids: List[int]
) -> Dict[int, int]:
    """
    Count images per bulk-upload job that have finished the pipeline.

    'Finished' means status in ('classified', 'failed') so a single
    image that crashes detection or classification doesn't freeze the
    job's progress bar at 99%.
    """
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
    """
    Flip jobs from 'processing' to 'done' when their derived progress
    has reached total. Done lazily on read so the bulk-upload worker
    does not have to know about classification timing.
    """
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


def _job_to_response(
    job: BulkUploadJob,
    camera_name: Optional[str],
    created_by_email: Optional[str],
    processed_files: int,
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
        started_at=job.started_at.isoformat() if job.started_at else None,
        finished_at=job.finished_at.isoformat() if job.finished_at else None,
        created_at=job.created_at.isoformat() if job.created_at else "",
        created_by_email=created_by_email,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_bulk_upload(
    project_id: int,
    file: UploadFile = File(...),
    camera_id: int = Form(...),
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Accept a single ZIP for a single camera.

    The ZIP is staged in `bulk-upload-staging` MinIO bucket. A row is
    inserted into `bulk_upload_jobs`. The bulk-upload worker picks the
    job up off the `bulk-upload-job` Redis queue and processes it.
    """
    # Validate the camera belongs to this project.
    camera = (
        await db.execute(
            select(Camera).where(
                Camera.id == camera_id,
                Camera.project_id == project_id,
            )
        )
    ).scalar_one_or_none()
    if camera is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Camera does not belong to this project",
        )

    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing filename",
        )
    if not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .zip uploads are supported",
        )

    # Read the upload into memory in chunks so we can enforce a hard cap
    # without trusting any client-reported Content-Length. For 20 GB
    # this would be heavy: in v1 we trust the cap and read everything;
    # if memory becomes a problem, switch to spooled-temp-file streaming.
    chunks: List[bytes] = []
    total = 0
    while True:
        chunk = await file.read(8 * 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_ZIP_SIZE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"ZIP exceeds the {MAX_ZIP_SIZE_BYTES // (1024 ** 3)} GB cap. "
                    "Split the SD card into smaller batches and retry."
                ),
            )
        chunks.append(chunk)
    body = b"".join(chunks)
    chunks.clear()

    if len(body) < 4 or body[:4] != b"PK\x03\x04":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File is not a valid ZIP (signature mismatch)",
        )

    # Quick entry-count check so we refuse oversized batches before
    # even staging them.
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as zf:
            entry_count = sum(
                1 for info in zf.infolist()
                if not info.is_dir() and not _is_noise_entry(info.filename)
            )
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="ZIP file is corrupted or truncated",
        )
    if entry_count > MAX_ZIP_ENTRIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"ZIP contains {entry_count} entries, the cap is {MAX_ZIP_ENTRIES}. "
                "Split the SD card into smaller batches."
            ),
        )

    job_uuid = str(uuid.uuid4())
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", file.filename).strip("_") or "upload.zip"
    staged_object_key = f"{project_id}/{job_uuid}.zip"

    storage = StorageClient()
    storage.upload_fileobj(io.BytesIO(body), BUCKET_BULK_UPLOAD_STAGING, staged_object_key)

    job = BulkUploadJob(
        uuid=job_uuid,
        project_id=project_id,
        created_by_user_id=user.id,
        camera_id=camera_id,
        original_filename=safe_name,
        staged_object_key=staged_object_key,
        status="queued",
        total_files=entry_count,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    queue = RedisQueue(QUEUE_BULK_UPLOAD_JOB)
    queue.publish({"job_uuid": job_uuid})

    logger.info(
        "Queued bulk upload",
        job_uuid=job_uuid,
        project_id=project_id,
        camera_id=camera_id,
        original_filename=safe_name,
        entry_count=entry_count,
        size_bytes=len(body),
        user_id=user.id,
    )

    return _job_to_response(
        job,
        camera_name=camera.name,
        created_by_email=user.email,
        processed_files=0,
    )


@router.get("/jobs", response_model=List[BulkUploadJobResponse])
async def list_bulk_upload_jobs(
    project_id: int,
    user: User = Depends(require_project_admin_access),
    db: AsyncSession = Depends(get_async_session),
):
    """List bulk upload jobs for this project, most recent first."""
    rows = (
        await db.execute(
            select(BulkUploadJob, Camera.name, User.email)
            .join(Camera, BulkUploadJob.camera_id == Camera.id)
            .join(User, BulkUploadJob.created_by_user_id == User.id)
            .where(BulkUploadJob.project_id == project_id)
            .order_by(BulkUploadJob.created_at.desc())
            .limit(100)
        )
    ).all()
    jobs = [job for job, _, _ in rows]
    processed_counts = await _pipeline_done_counts(db, [j.id for j in jobs])
    await _finalise_done_jobs(db, jobs, processed_counts)
    return [
        _job_to_response(
            job,
            camera_name=cam_name,
            created_by_email=email,
            processed_files=processed_counts.get(job.id, 0),
        )
        for job, cam_name, email in rows
    ]


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
            .join(Camera, BulkUploadJob.camera_id == Camera.id)
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
    return _job_to_response(
        job,
        camera_name=cam_name,
        created_by_email=email,
        processed_files=processed_counts.get(job.id, 0),
    )
