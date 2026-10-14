"""
Database operations for SpeciesNet classification worker

Handles inserting classifications and updating image status.
"""
from sqlalchemy.orm import Session
from typing import List

from shared.database import get_db_session
from shared.models import Image, Detection, Classification as ClassificationModel, Camera, Project, TaxonomyMapping
from shared.logger import get_logger
from classifier import Classification, DetectionInfo

logger = get_logger("classification-speciesnet.db_operations")


def get_taxonomy_mapping() -> dict[str, str]:
    """
    Fetch all taxonomy mapping rows and return as {latin: common} dict.

    Returns:
        Dict mapping lowercase latin names to common names.
        Empty dict if no mapping is configured.
    """
    try:
        with get_db_session() as db:
            rows = db.query(TaxonomyMapping).all()
            return {row.latin: row.common for row in rows}
    except Exception as e:
        logger.error("Failed to fetch taxonomy mapping", error=str(e), exc_info=True)
        raise


def get_project_geofence(project_id: int | None) -> dict[str, str]:
    """
    Country code and admin1 region of a project, for the SpeciesNet geofence.

    Raises ValueError when the image has no project or the project has no
    country, so the image fails visibly instead of being classified without
    a geofence. Every project made since the country moved to the project
    has one.

    Returns:
        Dict with 'country_code' and 'admin1_region' ('' when unset).
    """
    if project_id is None:
        raise ValueError("Image has no project, cannot geofence")
    with get_db_session() as db:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.country_code:
            raise ValueError(f"Project {project_id} has no country, set one in project settings")
        return {
            "country_code": project.country_code,
            "admin1_region": project.admin1_region or "",
        }


def get_detections_for_image(image_uuid: str) -> tuple[int, int, int, List[DetectionInfo], int | None]:
    """
    Fetch detection records and project configuration for an image.

    Args:
        image_uuid: UUID of image

    Returns:
        Tuple of (image_id, image_width, image_height, list of DetectionInfo objects, project_id)
        project_id is None when the image's camera has no project

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

            # The project carries the classification config (country, and
            # the taxonomy mapping)
            camera = db.query(Camera).filter(Camera.id == image.camera_id).first()
            project_id = camera.project_id if camera else None

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
                project_id=project_id,
            )

            return (image.id, image_width, image_height, detection_infos, project_id)

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

    Populates raw_prediction and raw_confidence when available (SpeciesNet).

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

                # Set raw fields when available (SpeciesNet provides these)
                if hasattr(classification, 'raw_prediction') and classification.raw_prediction is not None:
                    classification_record.raw_prediction = classification.raw_prediction
                if hasattr(classification, 'raw_confidence') and classification.raw_confidence is not None:
                    classification_record.raw_confidence = classification.raw_confidence

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
