"""
Database operations for the classification worker

Handles inserting classifications and updating image status.
"""
from sqlalchemy.orm import Session
from typing import List

from shared.database import get_db_session
from shared.models import Image, Detection, Classification as ClassificationModel, Camera, Project, TaxonomyMapping
from shared.logger import get_logger
from records import Classification, DetectionInfo, ProjectConfig

logger = get_logger("classification.db_operations")


def models_in_use() -> list[str]:
    """The models the server's projects use, loaded at worker start."""
    with get_db_session() as db:
        rows = db.query(Project.classification_model).distinct().all()
    return sorted(row[0] for row in rows)


def get_project_species_config(project_id: int) -> tuple[dict[str, str], dict[str, str]]:
    """
    A SpeciesNet project's classification config: its taxonomy mapping and
    its geofence.

    Raises ValueError when the project has no taxonomy mapping or no
    country, so the image fails visibly instead of being classified without
    its label list or geofence. A SpeciesNet project gets both when it is
    created.

    Returns:
        ({lowercase latin: common}, {'country_code', 'admin1_region' ('' when unset)})
    """
    with get_db_session() as db:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project or not project.country_code:
            raise ValueError(f"Project {project_id} has no country, set one in project settings")
        rows = db.query(TaxonomyMapping).filter(TaxonomyMapping.project_id == project_id).all()
        if not rows:
            raise ValueError(f"Project {project_id} has no taxonomy mapping, upload one in project settings")
        taxonomy_map = {row.latin: row.common for row in rows}
        geofence = {
            "country_code": project.country_code,
            "admin1_region": project.admin1_region or "",
        }
        return taxonomy_map, geofence


def get_detections_for_image(image_uuid: str) -> tuple[int, int, int, List[DetectionInfo], ProjectConfig | None]:
    """
    Fetch detection records and project configuration for an image.

    Args:
        image_uuid: UUID of image

    Returns:
        Tuple of (image_id, image_width, image_height, list of DetectionInfo objects, project)
        project is None when the image's camera has no project

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

            # The project says which model classifies and which species
            # occur there
            camera = db.query(Camera).filter(Camera.id == image.camera_id).first()
            project_row = (
                db.query(Project).filter(Project.id == camera.project_id).first()
                if camera and camera.project_id is not None else None
            )
            project = ProjectConfig(
                project_id=project_row.id,
                classification_model=project_row.classification_model,
                included_species=project_row.included_species,
            ) if project_row else None

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
                project_id=project.project_id if project else None,
                model=project.classification_model if project else None,
            )

            return (image.id, image_width, image_height, detection_infos, project)

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

    Populates raw_prediction and raw_confidence when set (SpeciesNet).

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

                if classification.raw_prediction is not None:
                    classification_record.raw_prediction = classification.raw_prediction
                if classification.raw_confidence is not None:
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
