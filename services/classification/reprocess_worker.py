"""
Classification Reprocessing Worker

Consumes reprocessing requests and updates classification top-1 results
by applying project excluded_species filters to raw predictions.
"""
from typing import List, Optional

from shared.logger import get_logger, set_image_id
from shared.queue import RedisQueue, QUEUE_CLASSIFICATION_REPROCESS
from shared.database import get_db_session
from shared.models import Image, Detection, Classification
from config import get_settings

logger = get_logger("classification.reprocess")
settings = get_settings()


def find_top_species(raw_predictions: dict, excluded_species: List[str]) -> tuple[str, float]:
    """
    Find top-1 species from raw predictions excluding filtered species.

    Args:
        raw_predictions: Dict mapping species names to confidence scores
        excluded_species: List of species names to exclude

    Returns:
        Tuple of (species_name, confidence_score) for top-1 prediction

    Raises:
        ValueError: If no valid species remain after filtering
    """
    if not raw_predictions:
        raise ValueError("No raw predictions available")

    # Filter out excluded species
    valid_predictions = {
        species: confidence
        for species, confidence in raw_predictions.items()
        if species not in excluded_species
    }

    if not valid_predictions:
        raise ValueError("No valid species remain after filtering")

    # Find top-1
    top_species = max(valid_predictions.items(), key=lambda x: x[1])
    return top_species[0], top_species[1]


def process_reprocess_request(message: dict) -> None:
    """
    Process classification reprocessing request.

    Fetches all classifications for an image and recalculates top-1
    species by applying excluded_species filter to raw_predictions.

    Args:
        message: Queue message with image_uuid, project_id, excluded_species

    Raises:
        Exception: If processing fails (crashes worker)
    """
    image_uuid = message.get("image_uuid")
    project_id = message.get("project_id")
    excluded_species = message.get("excluded_species", [])

    if not image_uuid or not project_id:
        raise ValueError(f"Invalid message format: {message}")

    # Set correlation ID for logging
    set_image_id(image_uuid)

    logger.info(
        "Processing reprocessing request",
        image_uuid=image_uuid,
        project_id=project_id,
        num_excluded_species=len(excluded_species)
    )

    try:
        with get_db_session() as db:
            # Fetch image
            image = db.query(Image).filter(Image.uuid == image_uuid).first()
            if not image:
                raise ValueError(f"Image not found: {image_uuid}")

            # Fetch all detections and classifications for this image
            detections = db.query(Detection).filter(Detection.image_id == image.id).all()

            updated_count = 0
            skipped_count = 0

            for detection in detections:
                classifications = db.query(Classification).filter(
                    Classification.detection_id == detection.id
                ).all()

                for classification in classifications:
                    # Skip if no raw predictions
                    if not classification.raw_predictions:
                        logger.warning(
                            "Classification missing raw_predictions, skipping",
                            classification_id=classification.id,
                            detection_id=detection.id
                        )
                        skipped_count += 1
                        continue

                    # Recalculate top-1 with filters
                    try:
                        new_species, new_confidence = find_top_species(
                            classification.raw_predictions,
                            excluded_species
                        )

                        # Update if changed
                        if new_species != classification.species or new_confidence != classification.confidence:
                            old_species = classification.species
                            old_confidence = classification.confidence

                            classification.species = new_species
                            classification.confidence = new_confidence

                            logger.info(
                                "Classification updated",
                                classification_id=classification.id,
                                detection_id=detection.id,
                                old_species=old_species,
                                old_confidence=round(old_confidence, 4),
                                new_species=new_species,
                                new_confidence=round(new_confidence, 4)
                            )

                            updated_count += 1
                        else:
                            logger.debug(
                                "Classification unchanged",
                                classification_id=classification.id,
                                species=classification.species
                            )

                    except ValueError as e:
                        logger.error(
                            "Failed to find top species",
                            classification_id=classification.id,
                            detection_id=detection.id,
                            error=str(e)
                        )
                        skipped_count += 1
                        continue

            # Commit all changes
            db.commit()

            logger.info(
                "Reprocessing complete",
                image_uuid=image_uuid,
                updated=updated_count,
                skipped=skipped_count
            )

    except Exception as e:
        logger.error(
            "Reprocessing failed",
            image_uuid=image_uuid,
            project_id=project_id,
            error=str(e),
            exc_info=True
        )
        raise


def main():
    """Main entry point for reprocessing worker"""
    logger.info("Classification reprocessing worker starting", log_level=settings.log_level)

    # Initialize queue consumer
    queue = RedisQueue(QUEUE_CLASSIFICATION_REPROCESS)

    # Process messages forever
    logger.info("Listening for messages", queue=QUEUE_CLASSIFICATION_REPROCESS)
    queue.consume_forever(process_reprocess_request)


if __name__ == "__main__":
    main()
