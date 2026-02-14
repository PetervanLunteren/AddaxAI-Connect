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
from annotated_image import (
    generate_annotated_image,
    upload_annotated_image_to_minio,
    Detection as AnnotatedDetection,
    Classification as AnnotatedClassification
)

# Enable PIL to load truncated images from camera traps
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

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
                        # Generate annotated image and upload to MinIO for secure delivery
                        # Image is deleted after Telegram sends it (no public URLs)
                        annotated_minio_path = None

                        # Apply privacy blur to person/vehicle regions before annotation
                        from shared.models import Project, Detection as DetectionModel
                        project = db.query(Project).filter(Project.id == camera.project_id).first()
                        if project and project.blur_people_vehicles:
                            pv_dets = db.query(DetectionModel).filter(
                                DetectionModel.image_id == image.id,
                                DetectionModel.category.in_(["person", "vehicle"]),
                                DetectionModel.confidence >= project.detection_threshold,
                            ).all()
                            if pv_dets:
                                from PIL import Image as PILImage
                                from PIL import ImageFilter
                                img = PILImage.open(image_path)
                                if img.mode != 'RGB':
                                    img = img.convert('RGB')
                                img_w, img_h = img.size
                                for det in pv_dets:
                                    normalized = det.bbox.get('normalized')
                                    if not normalized or len(normalized) != 4:
                                        continue
                                    x_min_n, y_min_n, width_n, height_n = normalized
                                    x1 = max(0, int(x_min_n * img_w))
                                    y1 = max(0, int(y_min_n * img_h))
                                    x2 = min(img_w, int((x_min_n + width_n) * img_w))
                                    y2 = min(img_h, int((y_min_n + height_n) * img_h))
                                    if x2 > x1 and y2 > y1:
                                        region = img.crop((x1, y1, x2, y2))
                                        region = region.filter(ImageFilter.GaussianBlur(radius=15))
                                        img.paste(region, (x1, y1))
                                img.save(image_path, format='JPEG', quality=90)
                                logger.info("Applied privacy blur", image_uuid=image_uuid, num_blurred=len(pv_dets))

                        try:
                            # Build detection/classification pairs for annotation
                            # Match by detection_id and convert bbox to pixel coords
                            detection_classification_pairs = []
                            for classification in classifications:
                                # Find matching detection
                                matching_det = next(
                                    (d for d in detections if d.detection_id == classification.detection_id),
                                    None
                                )
                                if matching_det:
                                    # Convert normalized bbox to pixel coordinates
                                    bbox_n = matching_det.bbox_normalized
                                    pixel_bbox = {
                                        'x': int(bbox_n[0] * matching_det.image_width),
                                        'y': int(bbox_n[1] * matching_det.image_height),
                                        'width': int(bbox_n[2] * matching_det.image_width),
                                        'height': int(bbox_n[3] * matching_det.image_height)
                                    }
                                    ann_det = AnnotatedDetection(
                                        bbox=pixel_bbox,
                                        category=matching_det.category
                                    )
                                    ann_class = AnnotatedClassification(
                                        species=classification.species,
                                        confidence=classification.confidence
                                    )
                                    detection_classification_pairs.append((ann_det, ann_class))

                            if detection_classification_pairs:
                                # Generate and upload annotated image
                                annotated_bytes = generate_annotated_image(
                                    image_path=image_path,
                                    detections=detection_classification_pairs
                                )
                                annotated_minio_path = upload_annotated_image_to_minio(
                                    image_bytes=annotated_bytes,
                                    image_uuid=image_uuid
                                )
                                logger.info(
                                    "Generated annotated image for notifications",
                                    image_uuid=image_uuid,
                                    minio_path=annotated_minio_path
                                )
                        except Exception as e:
                            logger.warning(
                                "Failed to generate annotated image, notifications will be sent without image",
                                error=str(e)
                            )

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
                                "annotated_minio_path": annotated_minio_path,  # MinIO path for secure delivery
                                "timestamp": timestamp
                            })
                            logger.info(
                                "Published species detection notification",
                                species=species,
                                confidence=classification.confidence,
                                total_species_count=len(species_map),
                                annotated_minio_path=annotated_minio_path
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
