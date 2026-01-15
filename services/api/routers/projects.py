"""
Project endpoints for managing study areas and species configurations.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete as sql_delete
from pydantic import BaseModel, EmailStr

from shared.models import User, Project, Image, Detection, Classification, Camera, ProjectMembership, UserInvitation, EmailAllowlist
from shared.database import get_async_session
from shared.config import get_settings
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger
from auth.users import current_active_user
from auth.permissions import require_server_admin, require_project_admin_access, can_admin_project
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


class ProjectUserInfo(BaseModel):
    """User information in project context"""
    user_id: Optional[int] = None  # None for pending invitations
    email: str
    role: str
    is_registered: bool  # True for registered users, False for pending invitations
    is_active: bool
    is_verified: bool
    added_at: str


class ProjectUserListResponse(BaseModel):
    """Response for listing users in a project"""
    users: List[ProjectUserInfo]


class AddUserToProjectRequest(BaseModel):
    """Request to add user to project"""
    user_id: int
    role: str  # 'project-admin' or 'project-viewer'


class UpdateProjectUserRoleRequest(BaseModel):
    """Request to update user's role in project"""
    role: str  # 'project-admin' or 'project-viewer'


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
    current_user: User = Depends(require_server_admin),
):
    """
    Create a new project (server admin only)

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
    Update an existing project (project admin or server admin)

    Args:
        project_id: Project ID to update
        project_data: Fields to update

    Returns:
        Updated project

    Raises:
        HTTPException: If project not found or insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

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
    current_user: User = Depends(require_server_admin),
):
    """
    Delete a project with cascade deletion (server admin only)

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


@router.get(
    "/{project_id}/users",
    response_model=ProjectUserListResponse,
)
async def list_project_users(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    List all users in a project (project admin or server admin)

    Args:
        project_id: Project ID

    Returns:
        List of users with their roles in the project

    Raises:
        HTTPException: If project not found or insufficient permissions
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Verify project exists
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found",
        )

    # Get all project memberships with user details (registered users)
    query = (
        select(ProjectMembership, User)
        .join(User, ProjectMembership.user_id == User.id)
        .where(ProjectMembership.project_id == project_id)
    )
    result = await db.execute(query)
    memberships = result.all()

    users = []
    for membership, user in memberships:
        users.append(
            ProjectUserInfo(
                user_id=user.id,
                email=user.email,
                role=membership.role,
                is_registered=True,
                is_active=user.is_active,
                is_verified=user.is_verified,
                added_at=membership.created_at.isoformat(),
            )
        )

    # Get pending invitations for this project
    invitation_query = select(UserInvitation).where(
        UserInvitation.project_id == project_id
    )
    invitation_result = await db.execute(invitation_query)
    invitations = invitation_result.scalars().all()

    for invitation in invitations:
        users.append(
            ProjectUserInfo(
                user_id=None,  # No user_id yet - not registered
                email=invitation.email,
                role=invitation.role,
                is_registered=False,
                is_active=False,
                is_verified=False,
                added_at=invitation.created_at.isoformat(),
            )
        )

    return ProjectUserListResponse(users=users)


@router.post(
    "/{project_id}/users",
    status_code=status.HTTP_201_CREATED,
)
async def add_user_to_project(
    project_id: int,
    request: AddUserToProjectRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Add a user to a project with a specific role (project admin or server admin)

    Args:
        project_id: Project ID
        request: User ID and role to assign

    Returns:
        Success message

    Raises:
        HTTPException: If project/user not found, insufficient permissions, or user already in project
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Validate role
    valid_roles = ["project-admin", "project-viewer"]
    if request.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}",
        )

    # Verify project exists
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found",
        )

    # Verify user exists
    user_query = select(User).where(User.id == request.user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {request.user_id} not found",
        )

    # Check if user is already in project
    existing_query = select(ProjectMembership).where(
        ProjectMembership.user_id == request.user_id,
        ProjectMembership.project_id == project_id,
    )
    existing_result = await db.execute(existing_query)
    existing_membership = existing_result.scalar_one_or_none()

    if existing_membership:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User {user.email} is already a member of project {project.name}",
        )

    # Create membership
    membership = ProjectMembership(
        user_id=request.user_id,
        project_id=project_id,
        role=request.role,
        added_by_user_id=current_user.id,
    )
    db.add(membership)
    await db.commit()

    logger.info(
        "User added to project",
        user_id=request.user_id,
        project_id=project_id,
        role=request.role,
        added_by=current_user.id,
    )

    return {
        "message": f"User {user.email} added to project {project.name} as {request.role}",
    }


@router.patch(
    "/{project_id}/users/{user_id}",
)
async def update_project_user_role(
    project_id: int,
    user_id: int,
    request: UpdateProjectUserRoleRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Update a user's role in a project (project admin or server admin)

    Args:
        project_id: Project ID
        user_id: User ID
        request: New role to assign

    Returns:
        Success message

    Raises:
        HTTPException: If project/user not found, insufficient permissions, or user not in project
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Validate role
    valid_roles = ["project-admin", "project-viewer"]
    if request.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}",
        )

    # Verify project exists
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found",
        )

    # Verify user exists
    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found",
        )

    # Find membership
    membership_query = select(ProjectMembership).where(
        ProjectMembership.user_id == user_id,
        ProjectMembership.project_id == project_id,
    )
    membership_result = await db.execute(membership_query)
    membership = membership_result.scalar_one_or_none()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user.email} is not a member of project {project.name}",
        )

    # Update role
    old_role = membership.role
    membership.role = request.role
    await db.commit()

    logger.info(
        "Project user role updated",
        user_id=user_id,
        project_id=project_id,
        old_role=old_role,
        new_role=request.role,
        updated_by=current_user.id,
    )

    return {
        "message": f"User {user.email} role in project {project.name} updated from {old_role} to {request.role}",
    }


@router.delete(
    "/{project_id}/users/{user_id}",
    status_code=status.HTTP_200_OK,
)
async def remove_user_from_project(
    project_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Remove a user from a project (project admin or server admin)

    Args:
        project_id: Project ID
        user_id: User ID to remove

    Returns:
        Success message

    Raises:
        HTTPException: If project/user not found, insufficient permissions, or user not in project
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Verify project exists
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found",
        )

    # Verify user exists
    user_query = select(User).where(User.id == user_id)
    user_result = await db.execute(user_query)
    user = user_result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User with ID {user_id} not found",
        )

    # Find and delete membership
    membership_query = select(ProjectMembership).where(
        ProjectMembership.user_id == user_id,
        ProjectMembership.project_id == project_id,
    )
    membership_result = await db.execute(membership_query)
    membership = membership_result.scalar_one_or_none()

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user.email} is not a member of project {project.name}",
        )

    await db.delete(membership)
    await db.commit()

    logger.info(
        "User removed from project",
        user_id=user_id,
        project_id=project_id,
        removed_by=current_user.id,
    )

    return {
        "message": f"User {user.email} removed from project {project.name}",
    }


# Project User Invitation

class InviteProjectUserRequest(BaseModel):
    """Request to invite a new user to a project (project admin)"""
    email: EmailStr
    role: str  # 'project-admin' or 'project-viewer'


class AddProjectUserByEmailRequest(BaseModel):
    """Request to add a user to project by email (unified add/invite)"""
    email: EmailStr
    role: str  # 'project-admin' or 'project-viewer'


class AddProjectUserByEmailResponse(BaseModel):
    """Response for unified add/invite"""
    email: str
    role: str
    was_invited: bool  # True if invitation created, False if existing user added
    message: str


class ProjectInvitationResponse(BaseModel):
    """Response for project invitation"""
    email: str
    role: str
    project_id: int
    project_name: str
    message: str


@router.post(
    "/{project_id}/users/invite",
    response_model=ProjectInvitationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def invite_project_user(
    project_id: int,
    data: InviteProjectUserRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Invite a new user to a project (project admin or server admin)

    This creates an allowlist entry and pending invitation. When the user registers,
    they will automatically be assigned to this project with the specified role.

    Args:
        project_id: Project ID to invite user to
        data: Email and role (project-admin or project-viewer)
        db: Database session
        current_user: Current authenticated user (must be project admin or server admin)

    Returns:
        Invitation details

    Raises:
        HTTPException 403: Insufficient permissions
        HTTPException 404: Project not found
        HTTPException 400: Invalid role
        HTTPException 409: User already exists or invitation already sent
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Validate role
    valid_roles = ['project-admin', 'project-viewer']
    if data.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )

    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found"
        )

    # Check if user already exists
    existing_user = await db.execute(select(User).where(User.email == data.email))
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User with email {data.email} already exists. Use the add user endpoint instead."
        )

    # Check if invitation already exists for this project
    existing_invitation = await db.execute(
        select(UserInvitation).where(
            UserInvitation.email == data.email,
            UserInvitation.project_id == project_id
        )
    )
    if existing_invitation.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Invitation already sent to {data.email} for this project"
        )

    # Check if user has invitation for a different project
    existing_other_invitation = await db.execute(
        select(UserInvitation).where(UserInvitation.email == data.email)
    )
    if existing_other_invitation.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"User {data.email} already has a pending invitation for another project. Users can only have one pending invitation at a time."
        )

    # Add to allowlist if not already there
    existing_allowlist = await db.execute(
        select(EmailAllowlist).where(EmailAllowlist.email == data.email)
    )
    allowlist_entry = existing_allowlist.scalar_one_or_none()

    if not allowlist_entry:
        allowlist_entry = EmailAllowlist(
            email=data.email,
            is_superuser=False,  # Project invites never create server admins
            added_by_user_id=current_user.id
        )
        db.add(allowlist_entry)

    # Create invitation with role and project_id
    invitation = UserInvitation(
        email=data.email,
        invited_by_user_id=current_user.id,
        project_id=project_id,
        role=data.role
    )
    db.add(invitation)

    await db.commit()

    logger.info(
        "User invited to project",
        email=data.email,
        project_id=project_id,
        role=data.role,
        invited_by=current_user.id
    )

    return ProjectInvitationResponse(
        email=data.email,
        role=data.role,
        project_id=project_id,
        project_name=project.name,
        message=f"Invitation sent to {data.email}. They can now register and will be assigned as {data.role} in {project.name}."
    )


@router.post(
    "/{project_id}/users/add",
    response_model=AddProjectUserByEmailResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_project_user_by_email(
    project_id: int,
    data: AddProjectUserByEmailRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Unified endpoint to add user by email (project admin or server admin)

    Automatically handles both cases:
    - If user exists: Adds them to project immediately
    - If user doesn't exist: Creates invitation for registration

    Args:
        project_id: Project ID
        data: Email and role

    Returns:
        Success with indication of whether user was added or invited

    Raises:
        HTTPException: If insufficient permissions, invalid role, or conflicts
    """
    # Check project admin access
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Project admin access required for project {project_id}",
        )

    # Validate role
    valid_roles = ['project-admin', 'project-viewer']
    if data.role not in valid_roles:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}"
        )

    # Verify project exists
    project_result = await db.execute(
        select(Project).where(Project.id == project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with ID {project_id} not found"
        )

    # Check if user exists
    existing_user_result = await db.execute(
        select(User).where(User.email == data.email)
    )
    existing_user = existing_user_result.scalar_one_or_none()

    if existing_user:
        # User exists - add them to project

        # Check if user is already in project
        existing_membership = await db.execute(
            select(ProjectMembership).where(
                ProjectMembership.user_id == existing_user.id,
                ProjectMembership.project_id == project_id,
            )
        )
        if existing_membership.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User {data.email} is already a member of this project"
            )

        # Create membership
        membership = ProjectMembership(
            user_id=existing_user.id,
            project_id=project_id,
            role=data.role,
            added_by_user_id=current_user.id,
        )
        db.add(membership)
        await db.commit()

        logger.info(
            "Existing user added to project",
            user_id=existing_user.id,
            email=data.email,
            project_id=project_id,
            role=data.role,
            added_by=current_user.id,
        )

        return AddProjectUserByEmailResponse(
            email=data.email,
            role=data.role,
            was_invited=False,
            message=f"User {data.email} added to project {project.name} as {data.role}"
        )

    else:
        # User doesn't exist - create invitation

        # Check if invitation already exists for this project
        existing_invitation = await db.execute(
            select(UserInvitation).where(
                UserInvitation.email == data.email,
                UserInvitation.project_id == project_id
            )
        )
        if existing_invitation.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Invitation already sent to {data.email} for this project"
            )

        # Check if user has invitation for a different project
        existing_other_invitation = await db.execute(
            select(UserInvitation).where(UserInvitation.email == data.email)
        )
        if existing_other_invitation.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User {data.email} already has a pending invitation for another project"
            )

        # Add to allowlist if not already there
        existing_allowlist = await db.execute(
            select(EmailAllowlist).where(EmailAllowlist.email == data.email)
        )
        allowlist_entry = existing_allowlist.scalar_one_or_none()

        if not allowlist_entry:
            allowlist_entry = EmailAllowlist(
                email=data.email,
                is_superuser=False,
                added_by_user_id=current_user.id
            )
            db.add(allowlist_entry)

        # Create invitation
        invitation = UserInvitation(
            email=data.email,
            invited_by_user_id=current_user.id,
            project_id=project_id,
            role=data.role
        )
        db.add(invitation)
        await db.commit()

        logger.info(
            "User invited to project",
            email=data.email,
            project_id=project_id,
            role=data.role,
            invited_by=current_user.id
        )

        return AddProjectUserByEmailResponse(
            email=data.email,
            role=data.role,
            was_invited=True,
            message=f"Invitation sent to {data.email}. They can register and will be assigned as {data.role} in {project.name}"
        )
