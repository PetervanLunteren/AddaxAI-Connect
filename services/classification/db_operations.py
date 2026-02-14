"""
Database operations for classification worker

Handles inserting classifications and updating image status.
"""
from sqlalchemy.orm import Session
from typing import List

from shared.database import get_db_session
from shared.models import Image, Detection, Classification as ClassificationModel, Camera, Project
from shared.logger import get_logger
from classifier import Classification, DetectionInfo

logger = get_logger("classification.db_operations")


def get_detections_for_image(image_uuid: str) -> tuple[int, int, int, List[DetectionInfo], List[str] | None]:
    """
    Fetch detection records and project configuration for an image.

    Args:
        image_uuid: UUID of image

    Returns:
        Tuple of (image_id, image_width, image_height, list of DetectionInfo objects, included_species)
        included_species is None if all species are allowed, or a list of species names to include

    Raises:
        Exception: If query fails
    """
    logger.info("Fetching detections for image", image_uuid=image_uuid)

    try:
        with get_db_session() as db:
            # Get image record
            image = db.query(Image).filter(Image.uuid == image_uuid).first()

            if not image:
                raise ValueError(f"Image not found: {image_uuid}")

            # Get project's included species via camera
            included_species = None  # None = all species allowed
            camera = db.query(Camera).filter(Camera.id == image.camera_id).first()
            if camera and camera.project_id:
                project = db.query(Project).filter(Project.id == camera.project_id).first()
                if project and project.included_species:
                    included_species = project.included_species

            # Get image dimensions from metadata
            image_metadata = image.image_metadata or {}
            image_width = image_metadata.get('width')
            image_height = image_metadata.get('height')

            if not image_width or not image_height:
                raise ValueError(f"Image dimensions not found in metadata: {image_uuid}")

            # Get all detections for this image
            detections = db.query(Detection).filter(Detection.image_id == image.id).all()

            detection_infos = []
            for det in detections:
                bbox_normalized = det.bbox.get('normalized', [])
                if not bbox_normalized:
                    logger.warning(
                        "Detection missing normalized bbox, skipping",
                        detection_id=det.id
                    )
                    continue

                detection_info = DetectionInfo(
                    detection_id=det.id,
                    category=det.category or "unknown",
                    confidence=det.confidence,
                    bbox_normalized=bbox_normalized,
                    image_width=image_width,
                    image_height=image_height
                )
                detection_infos.append(detection_info)

            logger.info(
                "Detections fetched",
                image_uuid=image_uuid,
                num_detections=len(detection_infos),
                included_species_count=len(included_species) if included_species else 0,
                filter_mode="included" if included_species else "all"
            )

            return (image.id, image_width, image_height, detection_infos, included_species)

    except Exception as e:
        logger.error(
            "Failed to fetch detections",
            image_uuid=image_uuid,
            error=str(e),
            exc_info=True
        )
        raise


def insert_classifications(classifications: List[Classification]) -> List[int]:
    """
    Insert classification records into database.

    Args:
        classifications: List of Classification objects

    Returns:
        List of classification IDs

    Raises:
        Exception: If insert fails
    """
    if not classifications:
        logger.info("No classifications to insert")
        return []

    logger.info(
        "Inserting classifications",
        num_classifications=len(classifications)
    )

    try:
        with get_db_session() as db:
            classification_ids = []

            for classification in classifications:
                classification_record = ClassificationModel(
                    detection_id=classification.detection_id,
                    species=classification.species,
                    confidence=classification.confidence
                )

                db.add(classification_record)
                db.flush()  # Get ID without committing

                classification_ids.append(classification_record.id)

            db.commit()

            logger.info(
                "Classifications inserted",
                classification_ids=classification_ids
            )

            return classification_ids

    except Exception as e:
        logger.error(
            "Classification insert failed",
            error=str(e),
            exc_info=True
        )
        raise


def update_image_status(image_uuid: str, status: str) -> None:
    """
    Update image processing status.

    Args:
        image_uuid: UUID of image
        status: New status ('classified', 'failed')

    Raises:
        Exception: If update fails
    """
    logger.info("Updating image status", image_uuid=image_uuid, status=status)

    try:
        with get_db_session() as db:
            image = db.query(Image).filter(Image.uuid == image_uuid).first()

            if not image:
                raise ValueError(f"Image not found: {image_uuid}")

            image.status = status
            db.commit()

            logger.info("Image status updated", image_uuid=image_uuid, status=status)

    except Exception as e:
        logger.error(
            "Image status update failed",
            image_uuid=image_uuid,
            status=status,
            error=str(e),
            exc_info=True
        )
        raise
