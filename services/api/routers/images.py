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

from shared.models import User, Image, Camera, Detection, Classification
from shared.database import get_async_session
from shared.storage import StorageClient
from shared.config import get_settings
from auth.users import current_active_user


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
    status: str
    detection_count: int
    top_species: Optional[str] = None
    max_confidence: Optional[float] = None
    thumbnail_url: Optional[str] = None
    detections: List[DetectionResponse] = []
    image_width: Optional[int] = None
    image_height: Optional[int] = None

    class Config:
        from_attributes = True


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


@router.get(
    "/species",
    response_model=List[SpeciesOption],
)
async def get_species(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Get list of unique species found in classified images.

    Returns list of species for use in filter dropdown.
    """
    # Query for unique species from classifications
    query = (
        select(Classification.species)
        .distinct()
        .join(Detection)
        .join(Image)
        .where(Image.status == "classified")
        .order_by(Classification.species)
    )

    result = await db.execute(query)
    species_list = result.scalars().all()

    # Convert to label/value format for react-select
    return [
        SpeciesOption(label=species, value=species)
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
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
        db: Database session
        current_user: Current authenticated user

    Returns:
        Paginated list of images with detection summaries
    """
    # Build query filters
    filters = [
        # Only show images that have completed ML processing
        Image.status == "classified"
    ]

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

    # Count total
    count_query = select(func.count(Image.id))
    if filters:
        count_query = count_query.where(and_(*filters))

    # Add species filter if present (requires subquery)
    if species_filter:
        count_query = count_query.where(
            Image.id.in_(
                select(Image.id)
                .join(Detection)
                .join(Classification)
                .where(Classification.species.in_(species_filter))
            )
        )

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Calculate pagination
    pages = (total + limit - 1) // limit  # Ceiling division
    offset = (page - 1) * limit

    # Fetch images with joins
    query = (
        select(Image, Camera)
        .join(Camera, Image.camera_id == Camera.id)
        .options(selectinload(Image.detections).selectinload(Detection.classifications))
        .order_by(desc(Image.uploaded_at))
        .offset(offset)
        .limit(limit)
    )

    if filters:
        query = query.where(and_(*filters))

    # Add species filter if present (requires subquery)
    if species_filter:
        query = query.where(
            Image.id.in_(
                select(Image.id)
                .join(Detection)
                .join(Classification)
                .where(Classification.species.in_(species_filter))
            )
        )

    result = await db.execute(query)
    rows = result.all()

    # Build response items
    storage_client = StorageClient()
    items = []

    for image, camera in rows:
        # Count detections
        detection_count = len(image.detections)

        # Find top species and max confidence
        top_species = None
        max_confidence = None

        if image.detections:
            for detection in image.detections:
                if detection.classifications:
                    for classification in detection.classifications:
                        if max_confidence is None or classification.confidence > max_confidence:
                            max_confidence = classification.confidence
                            top_species = classification.species

        # Generate thumbnail URL using the streaming endpoint
        thumbnail_url = f"/api/images/{image.uuid}/thumbnail" if image.storage_path else None

        # Build detections response
        detections_response = []
        for detection in image.detections:
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
        if image.image_metadata:
            image_width = image.image_metadata.get('width')
            image_height = image.image_metadata.get('height')

        items.append(ImageListItemResponse(
            uuid=image.uuid,
            filename=image.filename,
            camera_id=image.camera_id,
            camera_name=camera.name,
            uploaded_at=image.uploaded_at.isoformat(),
            status=image.status,
            detection_count=detection_count,
            top_species=top_species,
            max_confidence=max_confidence,
            thumbnail_url=thumbnail_url,
            detections=detections_response,
            image_width=image_width,
            image_height=image_height,
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
    current_user: User = Depends(current_active_user),
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
    # Fetch image with all relations
    query = (
        select(Image, Camera)
        .join(Camera, Image.camera_id == Camera.id)
        .where(Image.uuid == uuid)
        .options(selectinload(Image.detections).selectinload(Detection.classifications))
    )

    result = await db.execute(query)
    row = result.one_or_none()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    image, camera = row

    # Generate full image URL using the streaming endpoint
    full_image_url = f"/api/images/{image.uuid}/full"

    # Build detections response
    detections_response = []
    for detection in image.detections:
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
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Stream image thumbnail directly from MinIO with authentication.

    Returns the pre-generated 300px thumbnail if available, otherwise falls back
    to the full-size image. Includes 1-hour cache for faster grid loading.
    """
    # Fetch image record
    query = select(Image).where(Image.uuid == uuid)
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    return await _stream_image_from_storage(image, use_thumbnail=True, cache_max_age=3600)


@router.get("/{uuid}/full")
async def get_image_full(
    uuid: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(current_active_user),
):
    """
    Stream full-size image directly from MinIO with authentication.

    This endpoint fetches the full-resolution image from MinIO and streams it
    to the client with JWT authentication. Includes 24-hour cache to reduce
    server load while maintaining security.
    """
    # Fetch image record
    query = select(Image).where(Image.uuid == uuid)
    result = await db.execute(query)
    image = result.scalar_one_or_none()

    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    return await _stream_image_from_storage(image, cache_max_age=86400)
