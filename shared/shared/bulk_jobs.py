"""
Bulk-upload job state shared across services.

A bulk upload can be stopped while it is still processing. Stopping just sets
the job status to "cancelled"; the workers cooperatively skip the rest of that
job's images using the checks below, so no detection or classification compute
is spent on a job the user has stopped. Live (FTPS) images never carry a bulk
job, so these checks are only called for bulk-origin work.
"""
from sqlalchemy import select

from shared.database import get_db_session
from shared.models import BulkUploadJob, Image


def is_bulk_job_cancelled(job_uuid: str) -> bool:
    """True when the bulk-upload job has been cancelled."""
    with get_db_session() as session:
        status = session.execute(
            select(BulkUploadJob.status).where(BulkUploadJob.uuid == job_uuid)
        ).scalar_one_or_none()
    return status == "cancelled"


def is_bulk_image_cancelled(image_uuid: str) -> bool:
    """
    True when this image belongs to a bulk-upload job that has been cancelled.

    Detection and classification call this for bulk-origin images and return
    early when it is True, before any MinIO download or model run. One indexed
    lookup, used only for bulk images.
    """
    with get_db_session() as session:
        status = session.execute(
            select(BulkUploadJob.status)
            .join(Image, Image.bulk_upload_job_id == BulkUploadJob.id)
            .where(Image.uuid == image_uuid)
        ).scalar_one_or_none()
    return status == "cancelled"
