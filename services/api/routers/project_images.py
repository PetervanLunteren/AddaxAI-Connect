"""
Project image upload/delete endpoints

Handles uploading and deleting project images and thumbnails.
"""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from shared.models import User, Project
from shared.database import get_async_session
from shared.config import get_settings
from auth.users import current_verified_user
from auth.permissions import can_admin_project
from utils.image_processing import process_and_upload_project_image, delete_project_images

router = APIRouter(prefix="/api/projects", tags=["project-images"])
settings = get_settings()


@router.post(
    "/{project_id}/image",
    status_code=status.HTTP_200_OK,
)
async def upload_project_image(
    project_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Upload project image (project admin or server admin)

    Uploads both original image and generates thumbnail (256x256).
    Validates file format (JPEG/PNG) and size (max 5MB).

    Args:
        project_id: Project ID
        file: Image file (JPEG or PNG, max 5MB)

    Returns:
        Updated project with image URLs

    Raises:
        HTTPException 404: Project not found
        HTTPException 400: Invalid file format or size
        HTTPException 403: Insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Check if project exists
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found"
        )

    # Delete existing images if present
    if project.image_path or project.thumbnail_path:
        delete_project_images(project.image_path, project.thumbnail_path)

    # Process and upload new image
    try:
        image_path, thumbnail_path = process_and_upload_project_image(file, project_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    # Update project record
    project.image_path = image_path
    project.thumbnail_path = thumbnail_path
    await db.commit()
    await db.refresh(project)

    # Build URLs for response (static files served by Nginx)
    image_url = f"/project-images/{image_path}" if image_path else None
    thumbnail_url = f"/project-images/{thumbnail_path}" if thumbnail_path else None

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "included_species": project.included_species,
        "image_url": image_url,
        "thumbnail_url": thumbnail_url,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }


@router.delete(
    "/{project_id}/image",
    status_code=status.HTTP_200_OK,
)
async def delete_project_image(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Delete project image (project admin or server admin)

    Removes both original image and thumbnail from MinIO and database.

    Args:
        project_id: Project ID

    Returns:
        Updated project without images

    Raises:
        HTTPException 404: Project not found
        HTTPException 403: Insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Check if project exists
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found"
        )

    # Delete images from MinIO
    delete_project_images(project.image_path, project.thumbnail_path)

    # Update project record
    project.image_path = None
    project.thumbnail_path = None
    await db.commit()
    await db.refresh(project)

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "included_species": project.included_species,
        "image_url": None,
        "thumbnail_url": None,
        "created_at": project.created_at.isoformat(),
        "updated_at": project.updated_at.isoformat() if project.updated_at else None,
    }
