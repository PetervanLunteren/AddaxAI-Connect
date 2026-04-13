"""
Camera reference image upload / delete endpoints.

Fieldworkers attach a phone photo of the install site (the tree, the
mounting post, a nearby landmark) to each camera so anyone revisiting
weeks later can find the exact spot. Mirrors the project image flow:
multipart upload, 512px thumbnail, local filesystem served by nginx.
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, Camera
from shared.database import get_async_session
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from utils.image_processing import (
    process_and_upload_reference_image,
    delete_reference_images,
)
from routers.cameras import camera_to_response, CameraResponse

router = APIRouter(prefix="/api/cameras", tags=["camera-reference-images"])


@router.post(
    "/{camera_id}/reference-image",
    response_model=CameraResponse,
)
async def upload_camera_reference_image(
    camera_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Upload a reference image for a camera (project admin or server admin).

    Validates JPEG/PNG, max 5MB. Stores the original plus a 512px
    thumbnail. Replaces any existing reference image for the same camera.
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID {camera_id} not found",
        )

    if camera.project_id is None or not await can_admin_project(current_user, camera.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    # Remove any existing files before writing the new ones.
    if camera.reference_image_path or camera.reference_thumbnail_path:
        delete_reference_images(camera.reference_image_path, camera.reference_thumbnail_path)

    try:
        image_path, thumbnail_path = process_and_upload_reference_image(file, camera_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    camera.reference_image_path = image_path
    camera.reference_thumbnail_path = thumbnail_path
    await db.commit()
    await db.refresh(camera)

    return camera_to_response(camera)


@router.delete(
    "/{camera_id}/reference-image",
    response_model=CameraResponse,
)
async def delete_camera_reference_image(
    camera_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Delete a camera's reference image (project admin or server admin).
    """
    result = await db.execute(select(Camera).where(Camera.id == camera_id))
    camera = result.scalar_one_or_none()

    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Camera with ID {camera_id} not found",
        )

    if camera.project_id is None or not await can_admin_project(current_user, camera.project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    delete_reference_images(camera.reference_image_path, camera.reference_thumbnail_path)

    camera.reference_image_path = None
    camera.reference_thumbnail_path = None
    await db.commit()
    await db.refresh(camera)

    return camera_to_response(camera)
