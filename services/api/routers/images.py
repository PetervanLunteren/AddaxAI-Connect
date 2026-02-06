"""
Image endpoints for viewing camera trap images with detections and classifications.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
import io

from shared.models import User, Image, Camera, Detection, Classification, Project, HumanObservation
from shared.database import get_async_session
from shared.storage import StorageClient
from shared.config import get_settings
from auth.users import current_verified_user
from auth.project_access import get_accessible_project_ids


router = APIRouter(prefix="/api/images", tags=["images"])
settings = get_settings()


class BoundingBox(BaseModel):
    """Bounding box coordinates"""
    x: float
    y: float
    width: float
    height: float


class ClassificationResponse(BaseModel):
    """Classification result"""
    id: int
    species: str
    confidence: float

    class Config:
        from_attributes = True


class DetectionResponse(BaseModel):
    """Detection result with classifications"""
    id: int
    category: str
    bbox: dict  # {x, y, width, height}
    confidence: float
    classifications: List[ClassificationResponse]

    class Config:
        from_attributes = True


class ImageListItemResponse(BaseModel):
    """Image list item with summary data"""
    uuid: str
    filename: str
    camera_id: int
    camera_name: str
    uploaded_at: str
    datetime_captured: Optional[str] = None  # EXIF DateTimeOriginal if available
    status: str
    detection_count: int
    top_species: Optional[str] = None
    max_confidence: Optional[float] = None
    thumbnail_url: Optional[str] = None
    detections: List[DetectionResponse] = []
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    is_verified: bool = False
    observed_species: List[str] = []  # Human observations for verified images

    class Config:
        from_attributes = True


# Human verification schemas (must be defined before ImageDetailResponse)
class HumanObservationResponse(BaseModel):
    """Human-entered species observation"""
    id: int
    species: str
    count: int
    created_at: str
    created_by_email: str
    updated_at: Optional[str] = None
    updated_by_email: Optional[str] = None

    class Config:
        from_attributes = True


class VerificationInfo(BaseModel):
    """Verification status for an image"""
    is_verified: bool
    verified_at: Optional[str] = None
    verified_by_email: Optional[str] = None
    notes: Optional[str] = None


class ImageDetailResponse(BaseModel):
    """Full image detail with all detections"""
    id: int
    uuid: str
    filename: str
    camera_id: int
    camera_name: str
    uploaded_at: str
    storage_path: str
    status: str
    image_metadata: dict
    full_image_url: str
    detections: List[DetectionResponse]
    verification: VerificationInfo
    human_observations: List[HumanObservationResponse]

    class Config:
        from_attributes = True


class PaginatedImagesResponse(BaseModel):
    """Paginated response for images"""
    items: List[ImageListItemResponse]
    total: int
    page: int
    limit: int
    pages: int


class SpeciesOption(BaseModel):
    """Species filter option"""
    label: str
    value: str


class HumanObservationInput(BaseModel):
    """Input for creating/updating a human observation"""
    species: str
    count: int = 1


class SaveVerificationRequest(BaseModel):
    """Request body for saving verification"""
    is_verified: bool
    notes: Optional[str] = None
    observations: List[HumanObservationInput]


class SaveVerificationResponse(BaseModel):
    """Response after saving verification"""
    message: str
    verification: VerificationInfo
    human_observations: List[HumanObservationResponse]


@router.get(
    "/species",
    response_model=List[SpeciesOption],
)
async def get_species(
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get list of unique species found in classified images.

    Returns list of species for use in filter dropdown (filtered by accessible projects).
    Includes species from both human observations (verified) and AI classifications (unverified).
    """
    from sqlalchemy import union_all

    # Query 1: Species from human observations (verified images)
    human_species = (
        select(HumanObservation.species.label('species'))
        .join(Image, HumanObservation.image_id == Image.id)
        .join(Camera, Image.camera_id == Camera.id)
        .where(
            and_(
                Image.status == "classified",
                Image.is_verified == True,
                Camera.project_id.in_(accessible_project_ids),
            )
        )
        .distinct()
    )

    # Query 2: Species from AI classifications (unverified images, above threshold)
    ai_species = (
        select(Classification.species.label('species'))
        .join(Detection)
        .join(Image)
        .join(Camera)
        .join(Project, Camera.project_id == Project.id)
        .where(
            and_(
                Image.status == "classified",
                Image.is_verified == False,
                Camera.project_id.in_(accessible_project_ids),
                Detection.confidence >= Project.detection_threshold
            )
        )
        .distinct()
    )

    # Combine and get unique species
    combined = union_all(human_species, ai_species).subquery()
    final_query = select(combined.c.species).distinct().order_by(combined.c.species)

    result = await db.execute(final_query)
    species_list = result.scalars().all()

    # Helper function to normalize labels (matches frontend normalizeLabel utility)
    def normalize_label(label: str) -> str:
        """Replace underscores with spaces and capitalize first letter"""
        normalized = label.replace('_', ' ')
        if normalized:
            normalized = normalized[0].upper() + normalized[1:]
        return normalized

    # Convert to label/value format for react-select
    return [
        SpeciesOption(
            label=normalize_label(species),
            value=species
        )
        for species in species_list
        if species  # Filter out any null/empty values
    ]


@router.get(
    "",
    response_model=PaginatedImagesResponse,
)
async def list_images(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    camera_id: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    species: Optional[str] = None,
    show_empty: bool = Query(False),
    verified: Optional[str] = Query(None),  # "true", "false", or None for all
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    List images with pagination and filters

    Args:
        page: Page number (starts at 1)
        limit: Items per page (max 100)
        camera_id: Filter by camera ID(s) - comma-separated for multiple
        start_date: Filter by start date (ISO format)
        end_date: Filter by end date (ISO format)
        species: Filter by species name(s) - comma-separated for multiple
        show_empty: If False (default), hide images without detections
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Paginated list of images with detection summaries (filtered by accessible projects)
    """
    # Build query filters
    filters = [
        # Only show images that have completed ML processing
        Image.status == "classified"
    ]

    # Filter by accessible projects (via camera.project_id)
    filters.append(Camera.project_id.in_(accessible_project_ids))

    # Handle camera_id filter (supports comma-separated values)
    if camera_id:
        camera_ids = [int(id.strip()) for id in camera_id.split(',') if id.strip()]
        if camera_ids:
            filters.append(Image.camera_id.in_(camera_ids))

    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            filters.append(Image.uploaded_at >= start_dt)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid start_date format. Use ISO format (YYYY-MM-DD)",
            )

    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            filters.append(Image.uploaded_at <= end_dt)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid end_date format. Use ISO format (YYYY-MM-DD)",
            )

    # Handle species filter (supports comma-separated values)
    # Need to join with classifications to filter by species
    species_filter = None
    if species:
        species_list = [s.strip() for s in species.split(',') if s.strip()]
        if species_list:
            species_filter = species_list

    # Handle verification status filter
    if verified is not None:
        if verified.lower() == "true":
            filters.append(Image.is_verified == True)
        elif verified.lower() == "false":
            filters.append(Image.is_verified == False)

    # Filter out empty images if show_empty is False (default)
    if not show_empty:
        # Only show images that have at least one detection above project threshold
        filters.append(
            Image.id.in_(
                select(Detection.image_id)
                .join(Image, Detection.image_id == Image.id)
                .join(Camera, Image.camera_id == Camera.id)
                .join(Project, Camera.project_id == Project.id)
                .where(Detection.confidence >= Project.detection_threshold)
                .distinct()
            )
        )

    # Count total (join with Camera for project filtering)
    count_query = select(func.count(Image.id)).join(Camera)
    if filters:
        count_query = count_query.where(and_(*filters))

    # Add species filter if present (requires subquery with threshold check)
    if species_filter:
        count_query = count_query.where(
            Image.id.in_(
                select(Image.id)
                .join(Detection)
                .join(Classification)
                .join(Camera, Image.camera_id == Camera.id)
                .join(Project, Camera.project_id == Project.id)
                .where(
                    and_(
                        Classification.species.in_(species_filter),
                        Detection.confidence >= Project.detection_threshold
                    )
                )
            )
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Calculate pagination
    pages = (total + limit - 1) // limit  # Ceiling division
    offset = (page - 1) * limit

    # Fetch images with joins (include Project for detection threshold)
    query = (
        select(Image, Camera, Project)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .options(selectinload(Image.detections).selectinload(Detection.classifications))
        .order_by(desc(Image.uploaded_at))
        .offset(offset)
        .limit(limit)
    )

    if filters:
        query = query.where(and_(*filters))

    # Add species filter if present (requires subquery with threshold check)
    if species_filter:
        query = query.where(
            Image.id.in_(
                select(Image.id)
                .join(Detection)
                .join(Classification)
                .join(Camera, Image.camera_id == Camera.id)
                .join(Project, Camera.project_id == Project.id)
                .where(
                    and_(
                        Classification.species.in_(species_filter),
                        Detection.confidence >= Project.detection_threshold
                    )
                )
            )
        )

    result = await db.execute(query)
    rows = result.all()

    # Build response items
    storage_client = StorageClient()
    items = []

    # Pre-fetch human observations for verified images in one query
    verified_image_ids = [image.id for image, camera, project in rows if image.is_verified]
    human_obs_by_image = {}
    if verified_image_ids:
        obs_result = await db.execute(
            select(HumanObservation)
            .where(HumanObservation.image_id.in_(verified_image_ids))
            .order_by(HumanObservation.count.desc())
        )
        for obs in obs_result.scalars().all():
            if obs.image_id not in human_obs_by_image:
                human_obs_by_image[obs.image_id] = []
            human_obs_by_image[obs.image_id].append(obs)

    for image, camera, project in rows:
        # Filter detections by project threshold
        visible_detections = [
            d for d in image.detections
            if d.confidence >= project.detection_threshold
        ]

        # For verified images: use human observations
        # For unverified images: use AI detections
        top_species = None
        max_confidence = None
        detection_count = 0

        observed_species = []  # List of all human-observed species for verified images

        if image.is_verified:
            # Use human observations for verified images
            observations = human_obs_by_image.get(image.id, [])
            if observations:
                # Top species = species with highest count
                top_obs = observations[0]  # Already sorted by count desc
                top_species = top_obs.species
                detection_count = sum(obs.count for obs in observations)
                max_confidence = None  # Human observations don't have confidence
                # Collect all observed species
                observed_species = [obs.species for obs in observations]
        else:
            # Use AI detections for unverified images
            detection_count = len(visible_detections)
            if visible_detections:
                for detection in visible_detections:
                    if detection.classifications:
                        for classification in detection.classifications:
                            if max_confidence is None or classification.confidence > max_confidence:
                                max_confidence = classification.confidence
                                top_species = classification.species

        # Generate thumbnail URL using the streaming endpoint
        thumbnail_url = f"/api/images/{image.uuid}/thumbnail" if image.storage_path else None

        # Build detections response (only visible detections)
        detections_response = []
        for detection in visible_detections:
            classifications_response = [
                ClassificationResponse(
                    id=cls.id,
                    species=cls.species,
                    confidence=cls.confidence,
                )
                for cls in detection.classifications
            ]

            # Transform bbox from database format {x_min, y_min, width, height}
            # to frontend format {x, y, width, height}
            bbox_transformed = {
                "x": detection.bbox.get("x_min", 0),
                "y": detection.bbox.get("y_min", 0),
                "width": detection.bbox.get("width", 0),
                "height": detection.bbox.get("height", 0),
            }

            detections_response.append(DetectionResponse(
                id=detection.id,
                category=detection.category,
                bbox=bbox_transformed,
                confidence=detection.confidence,
                classifications=classifications_response,
            ))

        # Get image dimensions from metadata
        image_width = None
        image_height = None
        datetime_captured = None
        if image.image_metadata:
            image_width = image.image_metadata.get('width')
            image_height = image.image_metadata.get('height')
            # Extract EXIF capture time if available
            datetime_captured = image.image_metadata.get('DateTimeOriginal')

        items.append(ImageListItemResponse(
            uuid=image.uuid,
            filename=image.filename,
            camera_id=image.camera_id,
            camera_name=camera.name,
            uploaded_at=image.uploaded_at.isoformat(),
            datetime_captured=datetime_captured,
            status=image.status,
            detection_count=detection_count,
            top_species=top_species,
            max_confidence=max_confidence,
            thumbnail_url=thumbnail_url,
            detections=detections_response,
            image_width=image_width,
            image_height=image_height,
            is_verified=image.is_verified,
            observed_species=observed_species,
        ))

    return PaginatedImagesResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
        pages=pages,
    )


@router.get(
    "/{uuid}",
    response_model=ImageDetailResponse,
)
async def get_image(
    uuid: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Get single image detail by UUID

    Args:
        uuid: Image UUID
        db: Database session
        current_user: Current authenticated user

    Returns:
        Full image detail with detections and classifications

    Raises:
        HTTPException: If image not found
    """
    # Fetch image with all relations (include Project for detection threshold)
    query = (
        select(Image, Camera, Project)
        .join(Camera, Image.camera_id == Camera.id)
        .join(Project, Camera.project_id == Project.id)
        .where(Image.uuid == uuid)
        .options(
            selectinload(Image.detections).selectinload(Detection.classifications),
            selectinload(Image.human_observations).selectinload(HumanObservation.created_by),
            selectinload(Image.human_observations).selectinload(HumanObservation.updated_by),
            selectinload(Image.verified_by),
        )
    )

    result = await db.execute(query)
    row = result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    image, camera, project = row

    # Filter detections by project threshold
    visible_detections = [
        d for d in image.detections
        if d.confidence >= project.detection_threshold
    ]

    # Generate full image URL using the streaming endpoint
    full_image_url = f"/api/images/{image.uuid}/full"

    # Build detections response (only visible detections)
    detections_response = []
    for detection in visible_detections:
        classifications_response = [
            ClassificationResponse(
                id=cls.id,
                species=cls.species,
                confidence=cls.confidence,
            )
            for cls in detection.classifications
        ]

        # Transform bbox from database format {x_min, y_min, width, height}
        # to frontend format {x, y, width, height}
        bbox_transformed = {
            "x": detection.bbox.get("x_min", 0),
            "y": detection.bbox.get("y_min", 0),
            "width": detection.bbox.get("width", 0),
            "height": detection.bbox.get("height", 0),
        }

        detections_response.append(DetectionResponse(
            id=detection.id,
            category=detection.category,
            bbox=bbox_transformed,
            confidence=detection.confidence,
            classifications=classifications_response,
        ))

    # Build verification info
    verification = VerificationInfo(
        is_verified=image.is_verified,
        verified_at=image.verified_at.isoformat() if image.verified_at else None,
        verified_by_email=image.verified_by.email if image.verified_by else None,
        notes=image.verification_notes,
    )

    # Build human observations response
    human_observations_response = [
        HumanObservationResponse(
            id=obs.id,
            species=obs.species,
            count=obs.count,
            created_at=obs.created_at.isoformat(),
            created_by_email=obs.created_by.email if obs.created_by else "unknown",
            updated_at=obs.updated_at.isoformat() if obs.updated_at else None,
            updated_by_email=obs.updated_by.email if obs.updated_by else None,
        )
        for obs in image.human_observations
    ]

    return ImageDetailResponse(
        id=image.id,
        uuid=image.uuid,
        filename=image.filename,
        camera_id=image.camera_id,
        camera_name=camera.name,
        uploaded_at=image.uploaded_at.isoformat(),
        storage_path=image.storage_path,
        status=image.status,
        image_metadata=image.image_metadata or {},
        full_image_url=full_image_url,
        detections=detections_response,
        verification=verification,
        human_observations=human_observations_response,
    )


@router.put(
    "/{uuid}/verification",
    response_model=SaveVerificationResponse,
)
async def save_verification(
    uuid: str,
    request: SaveVerificationRequest,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Save human verification for an image.

    This endpoint allows users to:
    - Add/update human observations (species + count at image level)
    - Mark the image as verified
    - Add verification notes

    Args:
        uuid: Image UUID
        request: Verification data (observations, is_verified, notes)
        accessible_project_ids: Project IDs accessible to user
        db: Database session
        current_user: Current authenticated user

    Returns:
        Updated verification info and observations

    Raises:
        HTTPException: If image not found or user lacks access
    """
    from datetime import datetime, timezone

    # Fetch image with camera for access check
    query = (
        select(Image)
        .join(Camera, Image.camera_id == Camera.id)
        .where(Image.uuid == uuid)
        .options(
            selectinload(Image.human_observations).selectinload(HumanObservation.created_by),
            selectinload(Image.human_observations).selectinload(HumanObservation.updated_by),
        )
    )
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Check project access
    camera_result = await db.execute(select(Camera).where(Camera.id == image.camera_id))
    camera = camera_result.scalar_one_or_none()
    if not camera or camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this image",
        )

    # Delete existing human observations for this image
    from sqlalchemy import delete
    await db.execute(
        delete(HumanObservation).where(HumanObservation.image_id == image.id)
    )

    # Insert new observations
    now = datetime.now(timezone.utc)
    new_observations = []
    for obs_input in request.observations:
        observation = HumanObservation(
            image_id=image.id,
            species=obs_input.species,
            count=obs_input.count,
            created_at=now,
            created_by_user_id=current_user.id,
        )
        db.add(observation)
        new_observations.append(observation)

    # Update verification fields on image
    image.is_verified = request.is_verified
    image.verification_notes = request.notes

    if request.is_verified:
        image.verified_at = now
        image.verified_by_user_id = current_user.id
    else:
        # If unmarking as verified, clear the timestamp but keep the user for audit
        image.verified_at = None

    await db.commit()

    # Refresh to get created IDs and relationships
    for obs in new_observations:
        await db.refresh(obs)
    await db.refresh(image)

    # Load user relationships for response
    user_result = await db.execute(select(User).where(User.id == current_user.id))
    user = user_result.scalar_one()

    # Build response
    verification = VerificationInfo(
        is_verified=image.is_verified,
        verified_at=image.verified_at.isoformat() if image.verified_at else None,
        verified_by_email=user.email if image.is_verified else None,
        notes=image.verification_notes,
    )

    human_observations_response = [
        HumanObservationResponse(
            id=obs.id,
            species=obs.species,
            count=obs.count,
            created_at=obs.created_at.isoformat(),
            created_by_email=user.email,
            updated_at=None,
            updated_by_email=None,
        )
        for obs in new_observations
    ]

    return SaveVerificationResponse(
        message="Verification saved successfully",
        verification=verification,
        human_observations=human_observations_response,
    )


async def _stream_image_from_storage(
    image: Image,
    use_thumbnail: bool = False,
    cache_max_age: int = 3600,
) -> StreamingResponse:
    """
    Internal helper to stream an image from MinIO storage.

    Args:
        image: Image database record
        use_thumbnail: If True, stream thumbnail instead of full image
        cache_max_age: Cache-Control max-age in seconds

    Returns:
        StreamingResponse with image data

    Raises:
        HTTPException: If image cannot be fetched from storage
    """
    # Determine bucket and object path
    if use_thumbnail and image.thumbnail_path:
        bucket = "thumbnails"
        object_name = image.thumbnail_path
    else:
        # Fall back to full image if no thumbnail or use_thumbnail=False
        bucket = "raw-images"
        object_name = image.storage_path

    # Fetch image from MinIO
    try:
        storage_client = StorageClient()
        image_data = storage_client.download_fileobj(bucket, object_name)

        # Determine content type from filename
        content_type = "image/jpeg"  # default
        if image.filename.lower().endswith('.png'):
            content_type = "image/png"
        elif image.filename.lower().endswith('.gif'):
            content_type = "image/gif"

        # Return as streaming response with caching
        return StreamingResponse(
            io.BytesIO(image_data),
            media_type=content_type,
            headers={
                "Cache-Control": f"private, max-age={cache_max_age}",
                "ETag": f'"{image.uuid}"',
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch image: {str(e)}",
        )


@router.get("/{uuid}/thumbnail")
async def get_image_thumbnail(
    uuid: str,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Stream image thumbnail directly from MinIO with authentication.

    Returns the pre-generated 300px thumbnail if available, otherwise falls back
    to the full-size image. Includes 1-hour cache for faster grid loading.
    """
    # Fetch image record with camera for project check
    query = select(Image).join(Camera).where(Image.uuid == uuid)
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Check project access
    camera_result = await db.execute(select(Camera).where(Camera.id == image.camera_id))
    camera = camera_result.scalar_one_or_none()
    if camera and camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this image"
        )

    return await _stream_image_from_storage(image, use_thumbnail=True, cache_max_age=3600)


@router.get("/{uuid}/full")
async def get_image_full(
    uuid: str,
    accessible_project_ids: List[int] = Depends(get_accessible_project_ids),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Stream full-size image directly from MinIO with authentication.

    This endpoint fetches the full-resolution image from MinIO and streams it
    to the client with JWT authentication. Includes 24-hour cache to reduce
    server load while maintaining security.
    """
    # Fetch image record with camera for project check
    query = select(Image).join(Camera).where(Image.uuid == uuid)
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    # Check project access
    camera_result = await db.execute(select(Camera).where(Camera.id == image.camera_id))
    camera = camera_result.scalar_one_or_none()
    if camera and camera.project_id not in accessible_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this image"
        )

    return await _stream_image_from_storage(image, cache_max_age=86400)


@router.get("/{uuid}/annotated")
async def get_annotated_image(
    uuid: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_verified_user),
):
    """
    Generate and return annotated image with bounding boxes and labels.

    Uses Playwright headless browser to render with exact same Canvas code as frontend,
    ensuring pixel-perfect matching between downloads and notifications.

    This endpoint:
    1. Fetches the image and its detections from the database
    2. Downloads the full image from MinIO
    3. Generates an annotated version using Playwright with Canvas rendering
    4. Returns the annotated JPEG with 1-hour cache

    Requires authentication. Notifications use MinIO-based delivery instead.
    """
    from utils.annotated_image_generator import generate_annotated_image

    # Fetch image record with camera to get project_id
    query = (
        select(Image)
        .where(Image.uuid == uuid)
        .options(
            selectinload(Image.detections).selectinload(Detection.classifications),
            selectinload(Image.camera)
        )
    )
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    if not image.camera or not image.camera.project_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Image camera or project not assigned",
        )

    # Check user has access to this project
    accessible_projects = await get_accessible_project_ids(db, current_user)
    if image.camera.project_id not in accessible_projects:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this image"
        )

    # Load project to get detection threshold
    project_result = await db.execute(
        select(Project).where(Project.id == image.camera.project_id)
    )
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Project not found",
        )

    # Get project detection threshold
    detection_threshold = project.detection_threshold

    # Download full image from MinIO
    try:
        storage_client = StorageClient()
        image_bytes = storage_client.download_fileobj("raw-images", image.storage_path)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch image from storage: {str(e)}",
        )

    # Get image dimensions from metadata
    if not image.image_metadata or 'width' not in image.image_metadata:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image metadata (width/height) not available",
        )

    natural_width = image.image_metadata['width']
    natural_height = image.image_metadata['height']

    # Transform detections into format expected by annotated_image_generator
    # Filter by project detection threshold
    detections_data = []
    for detection in image.detections:
        # Skip detections below project threshold
        if detection.confidence < detection_threshold:
            continue

        # Bbox is stored with both pixel coordinates and normalized array
        # Use pixel coordinates directly (x_min, y_min, width, height are already in pixels)
        bbox = detection.bbox
        bbox_pixels = {
            'x': int(bbox['x_min']),
            'y': int(bbox['y_min']),
            'width': int(bbox['width']),
            'height': int(bbox['height']),
        }

        # Get top classification if available
        classifications_list = []
        if detection.classifications:
            # Sort by confidence descending
            sorted_cls = sorted(detection.classifications, key=lambda c: c.confidence, reverse=True)
            for cls in sorted_cls:
                classifications_list.append({
                    'species': cls.species,
                    'confidence': cls.confidence
                })

        detections_data.append({
            'bbox': bbox_pixels,
            'category': detection.category,
            'confidence': detection.confidence,
            'classifications': classifications_list
        })

    # Log the detection data being sent to generator
    import sys
    print(f"DEBUG DETECTION DATA: {detections_data}", file=sys.stderr, flush=True)

    # Generate annotated image using Playwright
    try:
        annotated_bytes = await generate_annotated_image(
            image_bytes=image_bytes,
            detections=detections_data,
            natural_width=natural_width,
            natural_height=natural_height
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate annotated image: {str(e)}",
        )

    # Return as streaming response with caching
    return StreamingResponse(
        io.BytesIO(annotated_bytes),
        media_type="image/jpeg",
        headers={
            "Cache-Control": f"private, max-age=3600",
            "ETag": f'"{uuid}-annotated"',
        }
    )
