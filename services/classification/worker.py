"""
Classification Worker

Consumes detections from the detection queue, runs species classification, and stores results.
"""
import os

from shared.logger import get_logger, set_image_id
from shared.queue import RedisQueue, QUEUE_DETECTION_COMPLETE, QUEUE_CLASSIFICATION_COMPLETE, QUEUE_NOTIFICATION_EVENTS
from config import get_settings
from model_loader import load_model
from classifier import run_classification
from storage_operations import download_image_from_minio
from db_operations import get_detections_for_image, insert_classifications, update_image_status

logger = get_logger("classification")
settings = get_settings()


def process_detection_complete(message: dict, classifier) -> None:
    """
    Process detection-complete message through classification pipeline.

    Args:
        message: Queue message with detection metadata
        classifier: Loaded DeepFaune model

    Raises:
        Exception: If processing fails (crashes worker)
    """
    image_uuid = message.get("image_uuid")
    num_detections = message.get("num_detections", 0)
    detection_ids = message.get("detection_ids", [])

    if not image_uuid:
        raise ValueError(f"Invalid message format: {message}")

    # Set correlation ID for logging
    set_image_id(image_uuid)

    logger.info(
        "Processing classification request",
        image_uuid=image_uuid,
        num_detections=num_detections
    )

    temp_files = []

    try:
        # Step 1: Update status to classifying
        update_image_status(image_uuid, "classifying")

        # If no detections, skip classification
        if num_detections == 0:
            logger.info("No detections to classify, skipping", image_uuid=image_uuid)
            update_image_status(image_uuid, "classified")

            # Publish to next queue (for alerts worker)
            queue = RedisQueue(QUEUE_CLASSIFICATION_COMPLETE)
            queue.publish({
                "image_uuid": image_uuid,
                "num_classifications": 0,
                "classification_ids": []
            })

            logger.info("Image processing complete (no detections)", image_uuid=image_uuid)
            return

        # Step 2: Fetch detection records and project config from database
        image_id, image_width, image_height, detections, included_species = get_detections_for_image(image_uuid)

        # Check if any detections are animals
        animal_detections = [d for d in detections if d.category == "animal"]

        if not animal_detections:
            logger.info(
                "No animal detections to classify",
                image_uuid=image_uuid,
                num_detections=len(detections)
            )
            update_image_status(image_uuid, "classified")

            # Publish to next queue
            queue = RedisQueue(QUEUE_CLASSIFICATION_COMPLETE)
            queue.publish({
                "image_uuid": image_uuid,
                "num_classifications": 0,
                "classification_ids": []
            })

            logger.info("Image processing complete (no animals)", image_uuid=image_uuid)
            return

        # Step 3: Download full image from MinIO
        # Note: We need to fetch storage_path from database since it's not in queue message
        from shared.database import get_db_session
        from shared.models import Image
        with get_db_session() as db:
            image_record = db.query(Image).filter(Image.uuid == image_uuid).first()
            if not image_record:
                raise ValueError(f"Image not found: {image_uuid}")
            storage_path = image_record.storage_path

        image_path = download_image_from_minio(storage_path)
        temp_files.append(image_path)

        # Step 4: Run classification on animal detections with species filtering
        classifications = run_classification(classifier, image_path, detections, included_species)

        logger.info(
            "Classifications generated",
            image_uuid=image_uuid,
            num_classifications=len(classifications)
        )

        # Step 5: Insert classifications into database
        classification_ids = insert_classifications(classifications)

        # Step 6: Update image status to classified
        update_image_status(image_uuid, "classified")

        # Step 6.5: Publish notification events for each unique species detected
        if classifications:
            try:
                # Group classifications by species and get highest confidence for each
                species_map = {}
                for classification in classifications:
                    species = classification.species
                    if species not in species_map or classification.confidence > species_map[species].confidence:
                        species_map[species] = classification

                # Get camera info from image record
                from shared.database import get_db_session
                from shared.models import Image, Camera
                with get_db_session() as db:
                    image = db.query(Image).filter(Image.uuid == image_uuid).first()
                    camera = db.query(Camera).filter(Camera.id == image.camera_id).first() if image else None

                    if image and camera:
                        # Use API-generated annotated image URL instead of pre-generating
                        # This ensures exact visual match with frontend downloads
                        annotated_image_url = f"/api/images/{image_uuid}/annotated"

                        # Use image EXIF timestamp (DateTimeOriginal) or GPS from image, not camera
                        # Priority: Image GPS > Camera GPS
                        location = None
                        metadata = image.image_metadata or {}

                        # GPS coordinates are stored as gps_decimal: [lat, lon] tuple in metadata
                        gps_decimal = metadata.get('gps_decimal')
                        if gps_decimal and len(gps_decimal) == 2:
                            # Use GPS from image EXIF
                            location = {
                                "lat": gps_decimal[0],
                                "lon": gps_decimal[1]
                            }
                        elif camera.location:
                            # Fallback to camera location
                            location = {
                                "lat": camera.location.coords[1],
                                "lon": camera.location.coords[0]
                            }

                        # DateTimeOriginal is stored as ISO string in metadata
                        datetime_original = metadata.get('DateTimeOriginal')
                        timestamp = datetime_original if datetime_original else message.get("timestamp")

                        notification_queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)

                        # Publish one notification per unique species
                        for species, classification in species_map.items():
                            notification_queue.publish({
                                "event_type": "species_detection",
                                "project_id": camera.project_id,
                                "image_uuid": image_uuid,
                                "camera_id": camera.id,
                                "camera_name": camera.name,
                                "camera_location": location,
                                "species": species,
                                "confidence": classification.confidence,
                                "detection_count": len(classifications),
                                "annotated_image_url": annotated_image_url,  # API endpoint URL
                                "timestamp": timestamp
                            })
                            logger.info(
                                "Published species detection notification",
                                species=species,
                                confidence=classification.confidence,
                                total_species_count=len(species_map),
                                annotated_url=annotated_image_url
                            )
            except Exception as e:
                logger.error("Failed to publish notification event", error=str(e))

        # Step 7: Publish to classification-complete queue
        queue = RedisQueue(QUEUE_CLASSIFICATION_COMPLETE)
        queue.publish({
            "image_uuid": image_uuid,
            "num_classifications": len(classifications),
            "classification_ids": classification_ids
        })

        logger.info(
            "Image processing complete",
            image_uuid=image_uuid,
            num_classifications=len(classifications),
            classification_ids=classification_ids
        )

    except Exception as e:
        # Update status to failed
        try:
            update_image_status(image_uuid, "failed")
        except Exception as db_error:
            logger.error("Failed to update status to failed", error=str(db_error))

        logger.error(
            "Image classification failed",
            image_uuid=image_uuid,
            error=str(e),
            exc_info=True
        )
        raise

    finally:
        # Cleanup temporary files
        for temp_file in temp_files:
            try:
                os.unlink(temp_file)
            except Exception:
                pass


def main():
    """Main entry point for classification worker"""
    logger.info("Classification worker starting", log_level=settings.log_level)

    # Load model on startup
    logger.info("Loading DeepFaune v1.4 model")
    classifier = load_model()
    logger.info("Model loaded successfully")

    # Initialize queue consumer
    queue = RedisQueue(QUEUE_DETECTION_COMPLETE)

    # Process messages forever
    logger.info("Listening for messages", queue=QUEUE_DETECTION_COMPLETE)
    queue.consume_forever(lambda msg: process_detection_complete(msg, classifier))


if __name__ == "__main__":
    main()
