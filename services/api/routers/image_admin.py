"""
Admin endpoints for image management (hide, unhide, delete).

Allows project admins to manage images: hide from analysis, restore hidden images,
or permanently delete images and their associated data.
"""
from typing import List, Optional, Tuple
from datetime import datetime, timedelta
import io
import re
import zipfile
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, asc, update, delete as sql_delete, cast, Float
from sqlalchemy.orm import selectinload
from pydantic import BaseModel

from shared.models import User, Image, Camera, Detection, Classification, Project, HumanObservation, CameraDeploymentPeriod
from shared.database import get_async_session
from shared.storage import StorageClient, BUCKET_RAW_IMAGES, BUCKET_CROPS, BUCKET_THUMBNAILS
from shared.logger import get_logger
from shared.classification_threshold import classification_passes_threshold
from auth.users import current_verified_user
from auth.permissions import can_admin_project

# Caps for the bulk-download endpoint. Count is the hard ceiling so the
# server never holds an unbounded zip in memory; the implicit byte budget
# at ~4 MB/image puts the zip near 2 GB.
BULK_DOWNLOAD_MAX_IMAGES = 500

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


class AdminImageFilterParams(BaseModel):
    """
    Filter parameters mirroring the curation list endpoint. Used by the
    bulk actions to operate on "every image matching these filters",
    not just a hand-picked uuid list.
    """
    camera_id: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    species: Optional[str] = None
    verified: Optional[str] = None
    hidden: Optional[str] = None
    search: Optional[str] = None
    tags: Optional[str] = None
    liked: Optional[str] = None
    needs_review: Optional[str] = None
    min_detection_confidence: Optional[float] = None
    max_detection_confidence: Optional[float] = None
    min_classification_confidence: Optional[float] = None
    max_classification_confidence: Optional[float] = None


class BulkImageActionRequest(BaseModel):
    """
    Bulk action target. Provide exactly one of:
    - `image_uuids`: explicit uuid list (per-page selection).
    - `filters`: every image matching these filters (select-all-matching).
    """
    image_uuids: Optional[List[str]] = None
    filters: Optional[AdminImageFilterParams] = None


class BulkImageActionResponse(BaseModel):
    success_count: int
    failed_count: int
    errors: List[str] = []


async def _build_filter_clauses(
    db: AsyncSession,
    project_id: int,
    *,
    camera_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    species: Optional[str] = None,
    verified: Optional[str] = None,
    hidden: Optional[str] = None,
    search: Optional[str] = None,
    tags: Optional[str] = None,
    liked: Optional[str] = None,
    needs_review: Optional[str] = None,
    min_detection_confidence: Optional[float] = None,
    max_detection_confidence: Optional[float] = None,
    min_classification_confidence: Optional[float] = None,
    max_classification_confidence: Optional[float] = None,
) -> list:
    """Build the SQLAlchemy filter clauses for curation list and bulk actions."""
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

    if liked is not None:
        if liked.lower() == "true":
            filters.append(Image.is_liked == True)
        elif liked.lower() == "false":
            filters.append(Image.is_liked == False)

    if needs_review is not None:
        if needs_review.lower() == "true":
            filters.append(Image.needs_review == True)
        elif needs_review.lower() == "false":
            filters.append(Image.needs_review == False)

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            filters.append(Image.captured_at >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")

    if end_date:
        try:
            # A date-only input includes the entire end day; see images.py
            # for the rationale. Datetime input is taken literally.
            if len(end_date) == 10:
                end_dt = datetime.fromisoformat(end_date) + timedelta(days=1)
                filters.append(Image.captured_at < end_dt)
            else:
                end_dt = datetime.fromisoformat(end_date)
                filters.append(Image.captured_at <= end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    if search:
        filters.append(Image.filename.ilike(f"%{search}%"))

    if tags:
        from sqlalchemy.dialects.postgresql import JSONB, ARRAY, TEXT as PG_TEXT
        tag_list = [t.strip().lower() for t in tags.split(',') if t.strip()]
        if tag_list:
            tag_camera_query = (
                select(Camera.id)
                .where(
                    Camera.project_id == project_id,
                    Camera.tags.isnot(None),
                    cast(Camera.tags, JSONB).has_any(cast(tag_list, ARRAY(PG_TEXT))),
                )
            )
            tag_result = await db.execute(tag_camera_query)
            matching_camera_ids = [row[0] for row in tag_result.all()]
            filters.append(Image.camera_id.in_(matching_camera_ids))

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

    # Confidence-range filter mirrors the same shape as in images.py:
    # restrict to AI predictions, exclude verified images once narrowed.
    det_active = (
        min_detection_confidence is not None
        or max_detection_confidence is not None
    )
    cls_active = (
        min_classification_confidence is not None
        or max_classification_confidence is not None
    )
    if det_active or cls_active:
        filters.append(Image.is_verified == False)

        animal_match = (
            select(Detection.image_id)
            .join(Classification, Classification.detection_id == Detection.id)
            .join(Image, Detection.image_id == Image.id)
            .join(Camera, Image.camera_id == Camera.id)
            .join(Project, Camera.project_id == Project.id)
            .where(
                Detection.category == "animal",
                Detection.confidence >= Project.detection_threshold,
                classification_passes_threshold(),
            )
        )
        if min_detection_confidence is not None:
            animal_match = animal_match.where(
                Detection.confidence >= min_detection_confidence
            )
        if max_detection_confidence is not None:
            animal_match = animal_match.where(
                Detection.confidence <= max_detection_confidence
            )
        if min_classification_confidence is not None:
            animal_match = animal_match.where(
                Classification.confidence >= min_classification_confidence
            )
        if max_classification_confidence is not None:
            animal_match = animal_match.where(
                Classification.confidence <= max_classification_confidence
            )

        if cls_active:
            filters.append(Image.id.in_(animal_match))
        else:
            pv_match = (
                select(Detection.image_id)
                .join(Image, Detection.image_id == Image.id)
                .join(Camera, Image.camera_id == Camera.id)
                .join(Project, Camera.project_id == Project.id)
                .where(
                    Detection.category.in_(["person", "vehicle"]),
                    Detection.confidence >= Project.detection_threshold,
                )
            )
            if min_detection_confidence is not None:
                pv_match = pv_match.where(
                    Detection.confidence >= min_detection_confidence
                )
            if max_detection_confidence is not None:
                pv_match = pv_match.where(
                    Detection.confidence <= max_detection_confidence
                )
            filters.append(
                or_(Image.id.in_(animal_match), Image.id.in_(pv_match))
            )

    return filters


async def _resolve_target_image_ids(
    db: AsyncSession,
    project_id: int,
    body: BulkImageActionRequest,
) -> Tuple[List[int], List[str], List[str]]:
    """
    Resolve a BulkImageActionRequest to a concrete set of image rows.

    Returns (image_ids, valid_uuids, errors). `errors` lists uuids that
    were sent explicitly but did not match the project. For the filter
    path, errors is always empty.
    """
    if body.image_uuids is None and body.filters is None:
        raise HTTPException(
            status_code=400,
            detail="Provide either image_uuids or filters",
        )
    if body.image_uuids is not None and body.filters is not None:
        raise HTTPException(
            status_code=400,
            detail="Provide either image_uuids or filters, not both",
        )

    if body.image_uuids is not None:
        if not body.image_uuids:
            return [], [], []
        result = await db.execute(
            select(Image.id, Image.uuid)
            .join(Camera, Image.camera_id == Camera.id)
            .where(
                Image.uuid.in_(body.image_uuids),
                Camera.project_id == project_id,
            )
        )
        rows = result.all()
        valid_uuids = {row.uuid for row in rows}
        image_ids = [row.id for row in rows]
        errors = [
            f"Image {uuid} not found in project"
            for uuid in body.image_uuids
            if uuid not in valid_uuids
        ]
        return image_ids, list(valid_uuids), errors

    # Filter-based selection.
    clauses = await _build_filter_clauses(
        db,
        project_id,
        **body.filters.model_dump(),
    )
    result = await db.execute(
        select(Image.id, Image.uuid)
        .join(Camera, Image.camera_id == Camera.id)
        .where(and_(*clauses))
    )
    rows = result.all()
    return [row.id for row in rows], [row.uuid for row in rows], []


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
    tags: Optional[str] = Query(None, description="Comma-separated camera tags"),
    liked: Optional[str] = Query(None),
    needs_review: Optional[str] = Query(None),
    min_detection_confidence: Optional[float] = Query(None, ge=0, le=1),
    max_detection_confidence: Optional[float] = Query(None, ge=0, le=1),
    min_classification_confidence: Optional[float] = Query(None, ge=0, le=1),
    max_classification_confidence: Optional[float] = Query(None, ge=0, le=1),
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

    filters = await _build_filter_clauses(
        db,
        project_id,
        camera_id=camera_id,
        start_date=start_date,
        end_date=end_date,
        species=species,
        verified=verified,
        hidden=hidden,
        search=search,
        tags=tags,
        liked=liked,
        needs_review=needs_review,
        min_detection_confidence=min_detection_confidence,
        max_detection_confidence=max_detection_confidence,
        min_classification_confidence=min_classification_confidence,
        max_classification_confidence=max_classification_confidence,
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

    _, valid_uuids, errors = await _resolve_target_image_ids(db, project_id, body)
    requested_count = (
        len(body.image_uuids) if body.image_uuids is not None else len(valid_uuids)
    )

    if valid_uuids:
        cam_result = await db.execute(
            select(Image.camera_id).where(Image.uuid.in_(valid_uuids)).distinct()
        )
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
        failed_count=requested_count - len(valid_uuids),
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

    _, valid_uuids, errors = await _resolve_target_image_ids(db, project_id, body)
    requested_count = (
        len(body.image_uuids) if body.image_uuids is not None else len(valid_uuids)
    )

    if valid_uuids:
        await db.execute(
            update(Image)
            .where(Image.uuid.in_(valid_uuids))
            .values(is_hidden=False)
        )
        await db.commit()

    return BulkImageActionResponse(
        success_count=len(valid_uuids),
        failed_count=requested_count - len(valid_uuids),
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

    image_ids, valid_uuids, errors = await _resolve_target_image_ids(db, project_id, body)
    requested_count = (
        len(body.image_uuids) if body.image_uuids is not None else len(valid_uuids)
    )

    if not image_ids:
        return BulkImageActionResponse(
            success_count=0,
            failed_count=requested_count,
            errors=errors,
        )

    images_result = await db.execute(
        select(Image).where(Image.id.in_(image_ids))
    )
    images = images_result.scalars().all()
    affected_camera_ids = {img.camera_id for img in images}

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
        failed_count=requested_count - success_count,
        errors=errors,
    )


def _safe_zip_member_path(camera_name: str, captured_at: Optional[datetime], filename: str) -> str:
    """
    Build a zip member path that avoids collisions across cameras and
    matching filenames. Camera-clock timestamp is treated as naive
    wall-clock for the purposes of the filename only.
    """
    def slugify(text: str) -> str:
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", text).strip("_")
        return slug or "unknown"

    cam_slug = slugify(camera_name)
    ts_slug = captured_at.strftime("%Y-%m-%d_%H-%M-%S") if captured_at else "unknown-time"
    file_slug = slugify(filename)
    return f"{cam_slug}/{ts_slug}_{file_slug}"


@router.post(
    "/download",
)
async def bulk_download_images(
    body: BulkImageActionRequest,
    project_id: int = Query(..., description="Project ID"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Stream a zip of raw originals for the targeted images.

    Caps at BULK_DOWNLOAD_MAX_IMAGES so the server never has to hold an
    unbounded zip in memory. Storage paths missing from MinIO are
    skipped silently (logged) so a single rotten object does not fail
    the whole request.
    """
    if not await can_admin_project(current_user, project_id, db):
        raise HTTPException(status_code=403, detail="Project admin access required")

    image_ids, _valid_uuids, _errors = await _resolve_target_image_ids(db, project_id, body)

    if not image_ids:
        raise HTTPException(status_code=400, detail="No images match the selection")

    if len(image_ids) > BULK_DOWNLOAD_MAX_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Bulk download is capped at {BULK_DOWNLOAD_MAX_IMAGES} images per request. "
                f"Selection matched {len(image_ids)} images, narrow the filters and try again."
            ),
        )

    rows_result = await db.execute(
        select(Image, Camera.name.label("camera_name"))
        .join(Camera, Image.camera_id == Camera.id)
        .where(Image.id.in_(image_ids))
        .order_by(Camera.name.asc(), Image.captured_at.asc())
    )
    rows = rows_result.all()

    storage = StorageClient()
    project_name_result = await db.execute(
        select(Project.name).where(Project.id == project_id)
    )
    project_name = project_name_result.scalar_one_or_none() or f"project-{project_id}"
    project_slug = re.sub(r"[^A-Za-z0-9._-]+", "-", project_name).strip("-") or f"project-{project_id}"
    today = datetime.utcnow().strftime("%Y-%m-%d")
    zip_filename = f"images-{project_slug}-{today}.zip"

    buffer = io.BytesIO()
    skipped = 0
    written = 0
    used_paths: set[str] = set()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            image = row.Image
            if not image.storage_path:
                skipped += 1
                continue
            try:
                data = storage.download_fileobj(BUCKET_RAW_IMAGES, image.storage_path)
            except Exception as exc:
                logger.warning(
                    "Skipping missing raw image during bulk download",
                    image_uuid=image.uuid,
                    storage_path=image.storage_path,
                    error=str(exc),
                )
                skipped += 1
                continue

            base = _safe_zip_member_path(row.camera_name, image.captured_at, image.filename)
            member = base
            dedupe = 1
            while member in used_paths:
                member = f"{base}.{dedupe}"
                dedupe += 1
            used_paths.add(member)
            zf.writestr(member, data)
            written += 1

    if written == 0:
        raise HTTPException(
            status_code=502,
            detail="All matching raw images failed to download from storage",
        )

    buffer.seek(0)
    logger.info(
        "Bulk image download prepared",
        project_id=project_id,
        user_id=current_user.id,
        matched=len(image_ids),
        written=written,
        skipped=skipped,
        size_mb=round(buffer.getbuffer().nbytes / 1024 / 1024, 2),
    )
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
    )
