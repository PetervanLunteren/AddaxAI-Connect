"""
Database operations for detection worker

Handles inserting detections and updating image status.
"""
from sqlalchemy.orm import Session

from shared.database import get_db_session
from shared.models import Image, Detection as DetectionModel
from shared.logger import get_logger
from detector import Detection

logger = get_logger("detection.db_operations")


def update_image_status(image_uuid: str, status: str) -> None:
    """
    Update image processing status.

    Args:
        image_uuid: UUID of image
        status: New status ('processing', 'detected', 'failed')

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


def insert_detections(
    image_uuid: str,
    detections: list[Detection],
    crop_paths: list[str]
) -> list[int]:
    """
    Insert detection records into database.

    Args:
        image_uuid: UUID of source image
        detections: List of Detection objects
        crop_paths: List of crop storage paths (same order as detections)

    Returns:
        List of detection IDs

    Raises:
        Exception: If insert fails
    """
    logger.info(
        "Inserting detections",
        image_uuid=image_uuid,
        num_detections=len(detections)
    )

    try:
        with get_db_session() as db:
            # Get image record
            image = db.query(Image).filter(Image.uuid == image_uuid).first()

            if not image:
                raise ValueError(f"Image not found: {image_uuid}")

            # Insert detections
            detection_ids = []
            for detection, crop_path in zip(detections, crop_paths):
                # Create bbox dict for JSON storage
                bbox = {
                    "x_min": detection.bbox_pixels[0],
                    "y_min": detection.bbox_pixels[1],
                    "width": detection.bbox_pixels[2],
                    "height": detection.bbox_pixels[3],
                    "normalized": detection.bbox_normalized
                }

                detection_record = DetectionModel(
                    image_id=image.id,
                    bbox=bbox,
                    confidence=detection.confidence,
                    crop_path=crop_path
                )

                db.add(detection_record)
                db.flush()  # Get ID without committing

                detection_ids.append(detection_record.id)

            db.commit()

            logger.info(
                "Detections inserted",
                image_uuid=image_uuid,
                detection_ids=detection_ids
            )

            return detection_ids

    except Exception as e:
        logger.error(
            "Detection insert failed",
            image_uuid=image_uuid,
            error=str(e),
            exc_info=True
        )
        raise
