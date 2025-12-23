"""
Project endpoints for managing study areas and species configurations.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete as sql_delete
from pydantic import BaseModel

from shared.models import User, Project, Image, Detection, Classification
from shared.database import get_async_session
from shared.queue import RedisQueue, QUEUE_CLASSIFICATION_REPROCESS
from auth.users import current_active_user


router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    """Request body for creating a project"""
    name: str
    description: Optional[str] = None
    excluded_species: Optional[List[str]] = None


class ProjectUpdate(BaseModel):
    """Request body for updating a project"""
    name: Optional[str] = None
    description: Optional[str] = None
    excluded_species: Optional[List[str]] = None


class ProjectResponse(BaseModel):
    """Project response"""
    id: int
    name: str
    description: Optional[str] = None
    excluded_species: Optional[List[str]] = None
    created_at: str
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class ReprocessRequest(BaseModel):
    """Request to reprocess classifications for a project"""
    project_id: int


class ReprocessResponse(BaseModel):
    """Response from reprocessing trigger"""
    message: str
    images_queued: int
    project_id: int


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

    return [
        ProjectResponse(
            id=project.id,
            name=project.name,
            description=project.description,
            excluded_species=project.excluded_species,
            created_at=project.created_at.isoformat(),
            updated_at=project.updated_at.isoformat() if project.updated_at else None,
        )
        for project in projects
    ]


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

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        excluded_species=project.excluded_species,
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
        excluded_species=project_data.excluded_species,
    )

    db.add(project)
    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        excluded_species=project.excluded_species,
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
    if project_data.excluded_species is not None:
        project.excluded_species = project_data.excluded_species

    await db.commit()
    await db.refresh(project)

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        excluded_species=project.excluded_species,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat() if project.updated_at else None,
    )


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Delete a project

    Args:
        project_id: Project ID to delete

    Raises:
        HTTPException: If project not found
    """
    # Check if project exists
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Delete project
    await db.execute(sql_delete(Project).where(Project.id == project_id))
    await db.commit()


@router.post(
    "/reprocess",
    response_model=ReprocessResponse,
)
async def reprocess_classifications(
    request: ReprocessRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Trigger reprocessing of classifications for a project

    This endpoint queues all classified images from cameras in the specified project
    for reprocessing. The reprocessing will:
    1. Apply the project's excluded_species filter
    2. Recalculate top-1 species from raw_predictions excluding filtered species
    3. Update classification records with new top-1 species and confidence

    Args:
        request: Reprocessing request with project_id

    Returns:
        Number of images queued for reprocessing

    Raises:
        HTTPException: If project not found or no images to reprocess
    """
    project_id = request.project_id

    # Verify project exists
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found",
        )

    # Find all classified images from cameras in this project
    # Note: This assumes cameras have project_id foreign key
    from shared.models import Camera

    query = (
        select(Image)
        .join(Camera, Image.camera_id == Camera.id)
        .where(Camera.project_id == project_id)
        .where(Image.status == "classified")
    )

    result = await db.execute(query)
    images = result.scalars().all()

    if not images:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No classified images found for this project",
        )

    # Queue images for reprocessing
    queue = RedisQueue(QUEUE_CLASSIFICATION_REPROCESS)

    for image in images:
        queue.publish({
            "image_uuid": image.uuid,
            "project_id": project_id,
            "excluded_species": project.excluded_species or [],
        })

    return ReprocessResponse(
        message=f"Queued {len(images)} images for reprocessing",
        images_queued=len(images),
        project_id=project_id,
    )
