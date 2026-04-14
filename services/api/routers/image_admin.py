"""
Admin endpoints for image management (hide, unhide, delete).

Allows project admins to manage images: hide from analysis, restore hidden images,
or permanently delete images and their associated data.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, asc, update, delete as sql_delete
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification, Project, HumanObservation, CameraDeploymentPeriod
from shared.database import get_async_session
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger
from auth.users import current_verified_user
from auth.permissions import can_admin_project

router = APIRouter(prefix="/api/admin/images", tags=["image-admin"])
logger = get_logger("api.image_admin")


async def cleanup_empty_deployments(db: AsyncSession, camera_ids: set[int]):
    """Delete deployment periods that have no visible images (not hidden, not deleted)."""
    if not camera_ids:
        return

    for camera_id in camera_ids:
        # Find deployments for this camera that have zero non-hidden images
        deployments_query = (
            select(CameraDeploymentPeriod)
            .where(CameraDeploymentPeriod.camera_id == camera_id)
        )
        result = await db.execute(deployments_query)
        deployments = result.scalars().all()

        for dep in deployments:
            # Count non-hidden images within this deployment's date range
            date_filters = [
                Image.camera_id == camera_id,
                Image.is_hidden == False,
                Image.captured_at >= dep.start_date,
            ]
            if dep.end_date is not None:
                date_filters.append(Image.captured_at <= dep.end_date)

            count_query = (
                select(func.count(Image.id))
                .where(and_(*date_filters))
            )
            count_result = await db.execute(count_query)
            image_count = count_result.scalar_one()

            if image_count == 0:
                logger.info(
                    "Deleting empty deployment period",
                    camera_id=camera_id,
                    deployment_id=dep.deployment_id,
                )
                await db.delete(dep)


class AdminImageListItemResponse(BaseModel):
    uuid: str
    filename: str
    camera_id: int
    camera_name: str
    captured_at: str
    status: str
    detection_count: int
    top_species: Optional[str] = None
    max_confidence: Optional[float] = None
    thumbnail_url: Optional[str] = None
    detections: list = []
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    is_verified: bool = False
    is_hidden: bool = False
    observed_species: list = []

    class Config:
        from_attributes = True


class AdminPaginatedImagesResponse(BaseModel):
    items: List[AdminImageListItemResponse]
    total: int
    page: int
    limit: int
    pages: int


class BulkImageActionRequest(BaseModel):
    image_uuids: List[str]


class BulkImageActionResponse(BaseModel):
    success_count: int
    failed_count: int
    errors: List[str] = []


@router.get(
    "",
    response_model=AdminPaginatedImagesResponse,
)
async def list_all_images(
    project_id: int = Query(..., description="Project ID (required)"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    camera_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    species: Optional[str] = None,
    verified: Optional[str] = Query(None),
    hidden: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query("captured_at"),
    sort_dir: Optional[str] = Query("desc"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """List all images (including hidden) for admin management."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project admin access required",
        )

    filters = [
        Camera.project_id == project_id,
        Image.status == "classified",
    ]

    if camera_id is not None:
        filters.append(Image.camera_id == camera_id)

    if hidden is not None:
        if hidden.lower() == "true":
            filters.append(Image.is_hidden == True)
        elif hidden.lower() == "false":
            filters.append(Image.is_hidden == False)

    if verified is not None:
        if verified.lower() == "true":
            filters.append(Image.is_verified == True)
        elif verified.lower() == "false":
            filters.append(Image.is_verified == False)

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            filters.append(Image.captured_at >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            filters.append(Image.captured_at <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    if search:
        filters.append(Image.filename.ilike(f"%{search}%"))

    # Species filter: match by classification or human observation
    if species:
        species_list = [s.strip() for s in species.split(',') if s.strip()]
        if species_list:
            filters.append(
                or_(
                    Image.id.in_(
                        select(Detection.image_id)
                        .join(Classification)
                        .where(Classification.species.in_(species_list))
                        .distinct()
                    ),
                    Image.id.in_(
                        select(HumanObservation.image_id)
                        .where(HumanObservation.species.in_(species_list))
                        .distinct()
                    ),
                )
            )

    # Count query
    count_query = (
        select(func.count(Image.id))
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*filters))
    )
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Sorting
    sort_column_map = {
        "captured_at": Image.captured_at,
        "filename": Image.filename,
        "camera_name": Camera.name,
    }
    sort_col = sort_column_map.get(sort_by, Image.captured_at)
    order = desc(sort_col) if sort_dir == "desc" else asc(sort_col)

    # Data query
    offset = (page - 1) * limit
    data_query = (
        select(Image, Camera.name.label("camera_name"))
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*filters))
        .order_by(order)
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(data_query)
    rows = result.all()

    # Get image IDs for batch detection queries
    image_ids = [row.Image.id for row in rows]

    # Batch query: detection counts and top species per image
    detection_info = {}
    if image_ids:
        det_query = (
            select(
                Detection.image_id,
                func.count(Detection.id).label('det_count'),
            )
            .where(Detection.image_id.in_(image_ids))
            .group_by(Detection.image_id)
        )
        det_result = await db.execute(det_query)
        for row in det_result.all():
            detection_info[row.image_id] = row.det_count

        # Top species per image (from classifications)
        species_query = (
            select(
                Detection.image_id,
                Classification.species,
                Classification.confidence,
            )
            .join(Classification)
            .where(Detection.image_id.in_(image_ids))
            .order_by(Classification.confidence.desc())
        )
        species_result = await db.execute(species_query)
        top_species_map = {}
        top_confidence_map = {}
        for row in species_result.all():
            if row.image_id not in top_species_map:
                top_species_map[row.image_id] = row.species
                top_confidence_map[row.image_id] = row.confidence

    # Build response
    from shared.config import get_settings
    settings = get_settings()

    items = []
    for row in rows:
        image = row.Image
        camera_name = row.camera_name

        thumbnail_url = None
        if image.storage_path:
            thumbnail_url = f"/api/images/{image.uuid}/thumbnail"

        items.append(AdminImageListItemResponse(
            uuid=image.uuid,
            filename=image.filename,
            camera_id=image.camera_id,
            camera_name=camera_name,
            captured_at=image.captured_at.isoformat() if image.captured_at else "",
            status=image.status,
            detection_count=detection_info.get(image.id, 0),
            top_species=top_species_map.get(image.id) if image_ids else None,
            max_confidence=top_confidence_map.get(image.id) if image_ids else None,
            thumbnail_url=thumbnail_url,
            is_verified=image.is_verified,
            is_hidden=image.is_hidden,
        ))

    pages = (total + limit - 1) // limit if total > 0 else 1

    return AdminPaginatedImagesResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


@router.post(
    "/hide",
    response_model=BulkImageActionResponse,
)
async def bulk_hide_images(
    body: BulkImageActionRequest,
    project_id: int = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Bulk hide images from analysis."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(status_code=403, detail="Project admin access required")

    # Verify images belong to this project
    image_query = (
        select(Image.uuid)
        .join(Camera)
        .where(
            and_(
                Image.uuid.in_(body.image_uuids),
                Camera.project_id == project_id,
            )
        )
    )
    result = await db.execute(image_query)
    valid_uuids = {row[0] for row in result.all()}

    errors = []
    for uuid in body.image_uuids:
        if uuid not in valid_uuids:
            errors.append(f"Image {uuid} not found in project")

    if valid_uuids:
        # Get camera IDs for affected images before hiding
        camera_query = (
            select(Image.camera_id)
            .where(Image.uuid.in_(valid_uuids))
            .distinct()
        )
        cam_result = await db.execute(camera_query)
        affected_camera_ids = {row[0] for row in cam_result.all()}

        await db.execute(
            update(Image)
            .where(Image.uuid.in_(valid_uuids))
            .values(is_hidden=True)
        )
        await cleanup_empty_deployments(db, affected_camera_ids)
        await db.commit()

    return BulkImageActionResponse(
        success_count=len(valid_uuids),
        failed_count=len(body.image_uuids) - len(valid_uuids),
        errors=errors,
    )


@router.post(
    "/unhide",
    response_model=BulkImageActionResponse,
)
async def bulk_unhide_images(
    body: BulkImageActionRequest,
    project_id: int = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Bulk unhide images, restoring them to analysis."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(status_code=403, detail="Project admin access required")

    image_query = (
        select(Image.uuid)
        .join(Camera)
        .where(
            and_(
                Image.uuid.in_(body.image_uuids),
                Camera.project_id == project_id,
            )
        )
    )
    result = await db.execute(image_query)
    valid_uuids = {row[0] for row in result.all()}

    errors = []
    for uuid in body.image_uuids:
        if uuid not in valid_uuids:
            errors.append(f"Image {uuid} not found in project")

    if valid_uuids:
        await db.execute(
            update(Image)
            .where(Image.uuid.in_(valid_uuids))
            .values(is_hidden=False)
        )
        await db.commit()

    return BulkImageActionResponse(
        success_count=len(valid_uuids),
        failed_count=len(body.image_uuids) - len(valid_uuids),
        errors=errors,
    )


@router.post(
    "/delete",
    response_model=BulkImageActionResponse,
)
async def bulk_delete_images(
    body: BulkImageActionRequest,
    project_id: int = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """Permanently delete images and all associated data (detections, classifications, files)."""
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(status_code=403, detail="Project admin access required")

    # Load images with their data
    images_query = (
        select(Image)
        .join(Camera)
        .where(
            and_(
                Image.uuid.in_(body.image_uuids),
                Camera.project_id == project_id,
            )
        )
    )
    result = await db.execute(images_query)
    images = result.scalars().all()

    valid_uuids = {img.uuid for img in images}
    affected_camera_ids = {img.camera_id for img in images}
    errors = []
    for uuid in body.image_uuids:
        if uuid not in valid_uuids:
            errors.append(f"Image {uuid} not found in project")

    success_count = 0
    for image in images:
        try:
            # Delete classifications via detections
            detections_result = await db.execute(
                select(Detection).where(Detection.image_id == image.id)
            )
            detections = detections_result.scalars().all()

            for detection in detections:
                await db.execute(
                    sql_delete(Classification).where(Classification.detection_id == detection.id)
                )

            # Delete detections
            await db.execute(
                sql_delete(Detection).where(Detection.image_id == image.id)
            )

            # Delete human observations
            await db.execute(
                sql_delete(HumanObservation).where(HumanObservation.image_id == image.id)
            )

            # Delete image record
            await db.delete(image)

            # Delete MinIO files
            try:
                storage = StorageClient()
                if image.storage_path:
                    storage.delete_object(BUCKET_RAW_IMAGES, image.storage_path)
                if image.thumbnail_path:
                    storage.delete_object(BUCKET_THUMBNAILS, image.thumbnail_path)
                # Delete crops (named {image_uuid}_{idx}.jpg)
                crop_objects = storage.list_objects(BUCKET_CROPS, prefix=f"{image.uuid}_")
                for obj_name in crop_objects:
                    storage.delete_object(BUCKET_CROPS, obj_name)
            except Exception as e:
                logger.error(
                    "Failed to delete some MinIO files for image",
                    image_uuid=image.uuid,
                    error=str(e),
                )

            success_count += 1
        except Exception as e:
            errors.append(f"Failed to delete image {image.uuid}: {str(e)}")
            logger.error("Failed to delete image", image_uuid=image.uuid, error=str(e))

    await cleanup_empty_deployments(db, affected_camera_ids)
    await db.commit()

    return BulkImageActionResponse(
        success_count=success_count,
        failed_count=len(body.image_uuids) - success_count,
        errors=errors,
    )
