"""
Project endpoints for managing study areas and species configurations.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from pydantic import BaseModel

from shared.models import User, Project, Image, Detection, Classification, Camera
from shared.database import get_async_session
from shared.config import get_settings
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger
from auth.users import current_superuser, current_active_user
from utils.image_processing import delete_project_images


router = APIRouter(prefix="/api/projects", tags=["projects"])
settings = get_settings()
logger = get_logger("api.projects")


def build_project_image_urls(project: Project) -> tuple[str | None, str | None]:
    """
    Build image URLs for project.

    Args:
        project: Project model instance

    Returns:
        Tuple of (image_url, thumbnail_url)
    """
    minio_public_endpoint = settings.minio_public_endpoint or f"http://{settings.minio_endpoint}"

    image_url = None
    thumbnail_url = None

    if project.image_path:
        image_url = f"{minio_public_endpoint}/project-images/{project.image_path}"

    if project.thumbnail_path:
        thumbnail_url = f"{minio_public_endpoint}/project-images/{project.thumbnail_path}"

    return (image_url, thumbnail_url)


class ProjectCreate(BaseModel):
    """Request body for creating a project"""
    name: str
    description: Optional[str] = None
    included_species: Optional[List[str]] = None


class ProjectUpdate(BaseModel):
    """Request body for updating a project"""
    name: Optional[str] = None
    description: Optional[str] = None
    included_species: Optional[List[str]] = None


class ProjectDeleteResponse(BaseModel):
    """Response for project deletion with cascaded counts"""
    deleted_cameras: int
    deleted_images: int
    deleted_detections: int
    deleted_classifications: int
    deleted_minio_files: int


class ProjectResponse(BaseModel):
    """Project response"""
    id: int
    name: str
    description: Optional[str] = None
    included_species: Optional[List[str]] = None
    image_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    created_at: str
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


@router.get(
    "",
    response_model=List[ProjectResponse],
)
async def list_projects(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    List all projects

    Returns list of all projects with their excluded species configurations.
    """
    query = select(Project)
    result = await db.execute(query)
    projects = result.scalars().all()

    responses = []
    for project in projects:
        image_url, thumbnail_url = build_project_image_urls(project)
        responses.append(ProjectResponse(
            id=project.id,
            name=project.name,
            description=project.description,
            included_species=project.included_species,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            created_at=project.created_at.isoformat(),
            updated_at=project.updated_at.isoformat() if project.updated_at else None,
        ))

    return responses


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
)
async def get_project(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get single project by ID

    Args:
        project_id: Project ID

    Returns:
        Project details with excluded species configuration

    Raises:
        HTTPException: If project not found
    """
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    image_url, thumbnail_url = build_project_image_urls(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        included_species=project.included_species,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat() if project.updated_at else None,
    )


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_project(
    project_data: ProjectCreate,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Create a new project

    Args:
        project_data: Project creation data

    Returns:
        Created project
    """
    project = Project(
        name=project_data.name,
        description=project_data.description,
        included_species=project_data.included_species,
    )

    db.add(project)
    await db.commit()
    await db.refresh(project)

    image_url, thumbnail_url = build_project_image_urls(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        included_species=project.included_species,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat() if project.updated_at else None,
    )


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
)
async def update_project(
    project_id: int,
    project_data: ProjectUpdate,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Update an existing project

    Args:
        project_id: Project ID to update
        project_data: Fields to update

    Returns:
        Updated project

    Raises:
        HTTPException: If project not found
    """
    # Fetch existing project
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Update fields if provided
    if project_data.name is not None:
        project.name = project_data.name
    if project_data.description is not None:
        project.description = project_data.description
    if project_data.included_species is not None:
        project.included_species = project_data.included_species

    await db.commit()
    await db.refresh(project)

    image_url, thumbnail_url = build_project_image_urls(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        included_species=project.included_species,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat() if project.updated_at else None,
    )


@router.delete(
    "/{project_id}",
    response_model=ProjectDeleteResponse,
    status_code=status.HTTP_200_OK,
)
async def delete_project(
    project_id: int,
    confirm: str = Query(..., description="Project name to confirm deletion"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_superuser),
):
    """
    Delete a project with cascade deletion (superuser only)

    Deletes project and all associated data:
    - All cameras belonging to project
    - All images from those cameras
    - All detections from those images
    - All classifications from those detections
    - All MinIO files (raw-images, crops, thumbnails)
    - Project images

    Args:
        project_id: Project ID to delete
        confirm: Project name for confirmation (must match exactly)

    Returns:
        Deletion counts for all cascaded entities

    Raises:
        HTTPException 404: Project not found
        HTTPException 400: Confirmation name doesn't match
    """
    logger.info("Project deletion requested", project_id=project_id, user_id=current_user.id)

    # Check if project exists
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found"
        )

    # Verify confirmation
    if confirm != project.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Confirmation failed. Please type the exact project name: {project.name}"
        )

    # Initialize counters
    deleted_cameras = 0
    deleted_images = 0
    deleted_detections = 0
    deleted_classifications = 0
    deleted_minio_files = 0

    storage = StorageClient()

    # Step 1: Get all cameras for this project
    cameras_query = select(Camera).where(Camera.project_id == project_id)
    cameras_result = await db.execute(cameras_query)
    cameras = cameras_result.scalars().all()

    logger.info("Found cameras for project", project_id=project_id, camera_count=len(cameras))

    # Step 2: For each camera, cascade delete all data
    for camera in cameras:
        camera_imei = camera.imei or str(camera.id)

        # Get all images for this camera
        images_query = select(Image).where(Image.camera_id == camera.id)
        images_result = await db.execute(images_query)
        images = images_result.scalars().all()

        for image in images:
            # Get all detections for this image
            detections_query = select(Detection).where(Detection.image_id == image.id)
            detections_result = await db.execute(detections_query)
            detections = detections_result.scalars().all()

            for detection in detections:
                # Delete all classifications for this detection
                classifications_result = await db.execute(
                    sql_delete(Classification).where(Classification.detection_id == detection.id)
                )
                deleted_classifications += classifications_result.rowcount

            # Delete all detections for this image
            detections_result = await db.execute(
                sql_delete(Detection).where(Detection.image_id == image.id)
            )
            deleted_detections += detections_result.rowcount

        # Delete all images for this camera
        images_result = await db.execute(
            sql_delete(Image).where(Image.camera_id == camera.id)
        )
        deleted_images += images_result.rowcount

        # Delete MinIO files for this camera (raw-images, crops, thumbnails by IMEI)
        try:
            # List and delete objects in raw-images bucket
            raw_objects = storage.list_objects(BUCKET_RAW_IMAGES, prefix=f"{camera_imei}/")
            for obj_name in raw_objects:
                storage.delete_object(BUCKET_RAW_IMAGES, obj_name)
                deleted_minio_files += 1

            # List and delete objects in crops bucket
            crop_objects = storage.list_objects(BUCKET_CROPS, prefix=f"{camera_imei}/")
            for obj_name in crop_objects:
                storage.delete_object(BUCKET_CROPS, obj_name)
                deleted_minio_files += 1

            # List and delete objects in thumbnails bucket
            thumb_objects = storage.list_objects(BUCKET_THUMBNAILS, prefix=f"{camera_imei}/")
            for obj_name in thumb_objects:
                storage.delete_object(BUCKET_THUMBNAILS, obj_name)
                deleted_minio_files += 1

            logger.debug(
                "Deleted MinIO files for camera",
                camera_id=camera.id,
                imei=camera_imei,
                file_count=len(raw_objects) + len(crop_objects) + len(thumb_objects)
            )
        except Exception as e:
            logger.error(
                "Failed to delete some MinIO files",
                camera_id=camera.id,
                imei=camera_imei,
                error=str(e)
            )
            # Continue deletion even if MinIO cleanup fails

        deleted_cameras += 1

    # Step 3: Delete all cameras
    await db.execute(sql_delete(Camera).where(Camera.project_id == project_id))

    # Step 4: Delete project images from MinIO
    delete_project_images(project.image_path, project.thumbnail_path)

    # Step 5: Delete project
    await db.execute(sql_delete(Project).where(Project.id == project_id))
    await db.commit()

    logger.info(
        "Project deleted successfully",
        project_id=project_id,
        project_name=project.name,
        deleted_cameras=deleted_cameras,
        deleted_images=deleted_images,
        deleted_detections=deleted_detections,
        deleted_classifications=deleted_classifications,
        deleted_minio_files=deleted_minio_files
    )

    return ProjectDeleteResponse(
        deleted_cameras=deleted_cameras,
        deleted_images=deleted_images,
        deleted_detections=deleted_detections,
        deleted_classifications=deleted_classifications,
        deleted_minio_files=deleted_minio_files
    )
