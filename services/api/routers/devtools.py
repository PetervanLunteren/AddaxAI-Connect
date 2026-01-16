"""
Dev tools endpoints for development and testing.

Provides tools for server admins to:
- Upload files directly to FTPS directory
- Clear all data from database and storage

Only accessible by server admins.
"""
import os
import shutil
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification
from shared.database import get_async_session
from shared.storage import StorageClient
from shared.config import get_settings
from shared.logger import get_logger
from auth.permissions import require_server_admin


router = APIRouter(prefix="/api/devtools", tags=["devtools"])
logger = get_logger("api.devtools")
settings = get_settings()


class UploadResponse(BaseModel):
    """Response for file upload"""
    success: bool
    filename: str
    message: str


class ClearDataResponse(BaseModel):
    """Response for clear all data operation"""
    success: bool
    message: str
    deleted_counts: dict


@router.post("/upload", response_model=UploadResponse)
async def upload_file_to_ftps(
    file: UploadFile = File(...),
    current_user: User = Depends(require_server_admin),
):
    """
    Upload file directly to FTPS upload directory (server admin only)

    Bypasses normal FTPS upload workflow for debugging purposes.

    Args:
        file: File to upload (.jpg, .jpeg, .txt)
        current_user: Current authenticated server admin

    Returns:
        Upload result

    Raises:
        HTTPException: If file type not allowed or upload fails
    """
    # Validate file extension
    filename = file.filename or "unknown"
    ext = Path(filename).suffix.lower()

    allowed_extensions = {'.jpg', '.jpeg', '.txt'}
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type {ext} not allowed. Allowed: {', '.join(allowed_extensions)}"
        )

    # Get FTPS upload directory from environment
    ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
    upload_path = Path(ftps_dir) / filename

    logger.info(
        "Dev tools upload started",
        file_name=filename,
        user_id=current_user.id,
        user_email=current_user.email,
        upload_path=str(upload_path)
    )

    try:
        # Ensure directory exists
        upload_path.parent.mkdir(parents=True, exist_ok=True)

        # Write file
        with open(upload_path, "wb") as f:
            content = await file.read()
            f.write(content)

        logger.info(
            "Dev tools upload successful",
            file_name=filename,
            size_bytes=len(content),
            user_email=current_user.email
        )

        return UploadResponse(
            success=True,
            filename=filename,
            message=f"File uploaded successfully to {ftps_dir}"
        )

    except Exception as e:
        logger.error(
            "Dev tools upload failed",
            file_name=filename,
            error=str(e),
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )


@router.post("/clear-all-data", response_model=ClearDataResponse)
async def clear_all_data(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_server_admin),
):
    """
    Clear all data from database, MinIO, and FTPS directory (server admin only)

    WARNING: This is a destructive operation that cannot be undone.
    Deletes:
    - All database records (images, detections, classifications)
    - All MinIO objects (raw-images, crops, thumbnails buckets)
    - All files from FTPS upload directory

    Preserves:
    - Camera registrations (hardware inventory)
    - Projects, users, and email allowlist

    Args:
        db: Database session
        current_user: Current authenticated server admin

    Returns:
        Deletion results with counts
    """
    logger.warning(
        "Clear all data operation started",
        user_id=current_user.id,
        user_email=current_user.email
    )

    deleted_counts = {
        "classifications": 0,
        "detections": 0,
        "images": 0,
        "cameras": 0,
        "minio_raw_images": 0,
        "minio_crops": 0,
        "minio_thumbnails": 0,
        "ftps_files": 0,
    }

    try:
        # 1. Delete from database (in correct order due to foreign keys)
        # Classifications first (depends on detections)
        result = await db.execute(delete(Classification))
        deleted_counts["classifications"] = result.rowcount

        # Detections (depends on images)
        result = await db.execute(delete(Detection))
        deleted_counts["detections"] = result.rowcount

        # Images (depends on cameras)
        result = await db.execute(delete(Image))
        deleted_counts["images"] = result.rowcount

        # NOTE: Cameras are NOT deleted - they represent hardware inventory
        # and should persist even when clearing operational data
        deleted_counts["cameras"] = 0

        await db.commit()

        logger.info("Database cleared", deleted_counts=deleted_counts)

        # 2. Clear MinIO buckets
        storage = StorageClient()
        buckets = ["raw-images", "crops", "thumbnails"]

        for bucket in buckets:
            try:
                # List and delete all objects in bucket
                object_names = storage.list_objects(bucket)

                for obj_name in object_names:
                    storage.delete_object(bucket, obj_name)

                deleted_counts[f"minio_{bucket.replace('-', '_')}"] = len(object_names)

                logger.info(
                    "MinIO bucket cleared",
                    bucket=bucket,
                    objects_deleted=len(object_names)
                )
            except Exception as e:
                logger.error(
                    "Failed to clear MinIO bucket",
                    bucket=bucket,
                    error=str(e),
                    exc_info=True
                )

        # 3. Clear FTPS upload directory
        ftps_dir = os.getenv("FTPS_UPLOAD_DIR", "/uploads")
        ftps_path = Path(ftps_dir)

        if ftps_path.exists() and ftps_path.is_dir():
            files_deleted = 0
            for item in ftps_path.iterdir():
                try:
                    if item.is_file():
                        item.unlink()
                        files_deleted += 1
                    elif item.is_dir():
                        shutil.rmtree(item)
                        files_deleted += 1
                except Exception as e:
                    logger.error(
                        "Failed to delete FTPS item",
                        item=str(item),
                        error=str(e)
                    )

            deleted_counts["ftps_files"] = files_deleted
            logger.info("FTPS directory cleared", files_deleted=files_deleted)

        logger.warning(
            "Clear all data operation completed",
            user_email=current_user.email,
            deleted_counts=deleted_counts
        )

        return ClearDataResponse(
            success=True,
            message="All data cleared successfully",
            deleted_counts=deleted_counts
        )

    except Exception as e:
        logger.error(
            "Clear all data operation failed",
            error=str(e),
            exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear data: {str(e)}"
        )
