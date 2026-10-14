"""
SpeciesNet Classification Worker

Consumes detections from the detection queue, runs species classification, and stores results.
"""
import os

from shared.bulk_jobs import is_bulk_image_cancelled
from shared.logger import get_logger, set_image_id
from shared.queue import (
    RedisQueue,
    QUEUE_DETECTION_COMPLETE,
    QUEUE_DETECTION_COMPLETE_BULK,
    QUEUE_NOTIFICATION_EVENTS,
    HEARTBEAT_KEY_CLASSIFICATION,
    DEVICE_KEY_CLASSIFICATION,
)
from config import get_settings
from model_loader import load_model
import torch
from shared.device import select_device
from classifier import run_classification
from storage_operations import download_image_from_minio
from db_operations import get_detections_for_image, insert_classifications, update_image_status, get_project_species_config
from annotated_image import (
    generate_annotated_image,
    upload_annotated_image_to_minio,
    Detection as AnnotatedDetection,
    Classification as AnnotatedClassification
)

# Enable PIL to load truncated images from camera traps
from PIL import ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True

logger = get_logger("classification-speciesnet")
settings = get_settings()


def tier_bulk_raw_cold(image_uuid: str) -> None:
    """Push a finished bulk image's raw straight to the cold tier.

    Bulk uploads are old SD-card data that nobody browses in real time, so
    there is no reason to keep the raw on local disk waiting for the daily
    disk-budget watchdog. Once classification is done the raw is no longer
    read by the pipeline, so tag it cold here and let the ILM rule move it
    off-box. Best-effort: a tagging failure must not fail an already
    classified image. Inert when the cold tier is disabled.
    """
    from shared.database import get_db_session
    from shared.models import Image as ImageModel
    from shared.storage import StorageClient, BUCKET_RAW_IMAGES
    try:
        with get_db_session() as db:
            record = db.query(ImageModel).filter(ImageModel.uuid == image_uuid).first()
            storage_path = record.storage_path if record else None
        if storage_path:
            StorageClient().tag_object_cold(BUCKET_RAW_IMAGES, storage_path)
            logger.info("Tagged bulk raw image for cold tier", image_uuid=image_uuid)
    except Exception as e:
        logger.warning("Failed to tag bulk image cold", image_uuid=image_uuid, error=str(e))


def event_location_and_timestamp(image_record, fallback_timestamp):
    """Where and when for a species_detection event, from the photo's own EXIF.

    GPS comes from the photo (gps_decimal in its metadata), never from the
    camera row. The timestamp is DateTimeOriginal, or the queue message's
    timestamp when the photo carries none.
    """
    metadata = image_record.image_metadata or {}
    location = None
    gps_decimal = metadata.get('gps_decimal')
    if gps_decimal and len(gps_decimal) == 2:
        location = {"lat": gps_decimal[0], "lon": gps_decimal[1]}
    timestamp = metadata.get('DateTimeOriginal') or fallback_timestamp
    return location, timestamp


def publish_person_vehicle_events(camera, image_record, image_uuid, pv_dets,
                                  annotated_minio_path, fallback_timestamp) -> None:
    """Publish one species_detection event per person/vehicle category.

    pv_dets are the person and vehicle detections at or above the project
    threshold. annotated_minio_path is None when there is no photo to attach
    (privacy removal, or the annotation failed); the delivery workers then
    send text only.
    """
    location, timestamp = event_location_and_timestamp(image_record, fallback_timestamp)
    notification_queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)
    for category in sorted(set(d.category for d in pv_dets)):
        best_det = max(
            (d for d in pv_dets if d.category == category),
            key=lambda d: d.confidence
        )
        notification_queue.publish({
            "event_type": "species_detection",
            "project_id": camera.project_id,
            "image_uuid": image_uuid,
            "camera_id": camera.id,
            "camera_name": camera.device_id,
            "camera_location": location,
            "species": category,
            "confidence": best_det.confidence,
            "detection_confidence": best_det.confidence,
            "detection_count": len(pv_dets),
            "species_count": sum(1 for d in pv_dets if d.category == category),
            "annotated_minio_path": annotated_minio_path,
            "timestamp": timestamp
        })
        logger.info(
            "Published person/vehicle detection notification",
            species=category,
            confidence=best_det.confidence,
            annotated_minio_path=annotated_minio_path
        )


def remove_private_image(image_uuid: str, detections, message: dict, is_bulk: bool) -> bool:
    """Replace the photo with the privacy placeholder when the project asks for it.

    Runs before anything is downloaded. True means the image is finished
    here: the placeholder is in storage, the row is stamped and classified,
    and the person/vehicle alerts went out without a photo. False means the
    photo is kept and the normal pipeline continues. See shared/privacy.py.
    """
    from datetime import datetime, timezone
    from shared.database import get_db_session
    from shared.models import Image as ImageModel, Camera, Project
    from shared.privacy import PRIVACY_CATEGORIES, removed_categories, replace_with_placeholder
    from shared.storage import StorageClient

    with get_db_session() as db:
        image_record = db.query(ImageModel).filter(ImageModel.uuid == image_uuid).first()
        camera = db.query(Camera).filter(Camera.id == image_record.camera_id).first() if image_record else None
        project = db.query(Project).filter(Project.id == camera.project_id).first() if camera else None
        if not (image_record and camera and project):
            return False
        categories = removed_categories(detections, project)
        if not categories:
            return False

        # Objects first, stamp second. A failed upload raises here and leaves
        # an unstamped row (the image ends up failed, visible), never a
        # stamped row with the bytes still in storage.
        replace_with_placeholder(StorageClient(), image_record, categories)
        image_record.privacy_removed_at = datetime.now(timezone.utc)
        db.commit()
        logger.info(
            "Replaced photo with privacy placeholder",
            image_uuid=image_uuid,
            project_id=project.id,
            categories=categories,
        )

        # Same fan-out rule as a kept photo: live images alert, bulk never.
        # A failed publish loses the alert, not the image, like the branches
        # below: the placeholder is written and the row stamped by now.
        if not is_bulk:
            pv_dets = [d for d in detections
                       if d.category in PRIVACY_CATEGORIES and d.confidence >= project.detection_threshold]
            try:
                publish_person_vehicle_events(
                    camera, image_record, image_uuid, pv_dets, None, message.get("timestamp")
                )
            except Exception as e:
                logger.error("Failed to publish pv notification event", error=str(e))

    update_image_status(image_uuid, "classified")
    return True


def process_detection_complete(message: dict, classifier, ensemble) -> None:
    """
    Process detection-complete message through classification pipeline.

    Args:
        message: Queue message with detection metadata
        classifier: Loaded SpeciesNet classifier

    Raises:
        Exception: If processing fails (crashes worker)
    """
    image_uuid = message.get("image_uuid")
    num_detections = message.get("num_detections", 0)
    detection_ids = message.get("detection_ids", [])
    is_bulk = message.get("origin") == "bulk"

    if not image_uuid:
        raise ValueError(f"Invalid message format: {message}")

    # Set correlation ID for logging
    set_image_id(image_uuid)

    # Cooperative stop: skip images of a cancelled bulk job before any download
    # or classification. Only bulk-origin images can belong to a job.
    if is_bulk and is_bulk_image_cancelled(image_uuid):
        logger.info("Skipping cancelled bulk image", image_uuid=image_uuid)
        return

    logger.info(
        "Processing classification request",
        image_uuid=image_uuid,
        num_detections=num_detections,
        origin=message.get("origin", "live"),
    )

    temp_files = []

    try:
        # Step 1: Update status to classifying
        update_image_status(image_uuid, "classifying")

        # If no detections, skip classification
        if num_detections == 0:
            logger.info("No detections to classify, skipping", image_uuid=image_uuid)
            update_image_status(image_uuid, "classified")
            logger.info("Image processing complete (no detections)", image_uuid=image_uuid)
            return

        # Step 2: Fetch detection records and project config from database
        image_id, image_width, image_height, detections, project_id = get_detections_for_image(image_uuid)

        # Privacy removal comes first, before any download: a project that
        # deletes photos of people or vehicles never has this photo touched
        # again, and nothing below runs for it.
        if remove_private_image(image_uuid, detections, message, is_bulk):
            logger.info("Image processing complete (photo removed for privacy)", image_uuid=image_uuid)
            return

        # Check if any detections are animals
        animal_detections = [d for d in detections if d.category == "animal"]

        if not animal_detections:
            logger.info(
                "No animal detections to classify",
                image_uuid=image_uuid,
                num_detections=len(detections)
            )
            update_image_status(image_uuid, "classified")

            # Check for above-threshold person/vehicle detections to send notifications
            from shared.database import get_db_session
            from shared.models import Image as ImageModel, Camera, Project, Detection as DetectionModel
            with get_db_session() as db:
                image_record = db.query(ImageModel).filter(ImageModel.uuid == image_uuid).first()
                camera = db.query(Camera).filter(Camera.id == image_record.camera_id).first() if image_record else None
                project = db.query(Project).filter(Project.id == camera.project_id).first() if camera else None

                if image_record and camera and project:
                    det_threshold = project.detection_threshold
                    pv_dets = [d for d in detections
                               if d.category in ('person', 'vehicle') and d.confidence >= det_threshold]

                    # Bulk uploads suppress all live notifications.
                    if pv_dets and not is_bulk:
                        try:
                            # Download image for annotation
                            image_path = download_image_from_minio(image_record.storage_path)
                            temp_files.append(image_path)

                            # Apply privacy blur to the categories the
                            # project blurs (people and vehicles are
                            # independently configurable)
                            blur_dets = [d for d in pv_dets
                                         if d.category in project.blur_categories()]
                            if blur_dets:
                                from PIL import Image as PILImage
                                from PIL import ImageFilter
                                img = PILImage.open(image_path)
                                if img.mode != 'RGB':
                                    img = img.convert('RGB')
                                img_w, img_h = img.size
                                for det in blur_dets:
                                    normalized = det.bbox_normalized
                                    if not normalized or len(normalized) != 4:
                                        continue
                                    x_min_n, y_min_n, width_n, height_n = normalized
                                    x1 = max(0, int(x_min_n * img_w))
                                    y1 = max(0, int(y_min_n * img_h))
                                    x2 = min(img_w, int((x_min_n + width_n) * img_w))
                                    y2 = min(img_h, int((y_min_n + height_n) * img_h))
                                    if x2 > x1 and y2 > y1:
                                        region = img.crop((x1, y1, x2, y2))
                                        region = region.filter(ImageFilter.GaussianBlur(radius=25))
                                        img.paste(region, (x1, y1))
                                img.save(image_path, format='JPEG', quality=90)

                            # Generate annotated image with person/vehicle boxes
                            annotated_minio_path = None
                            try:
                                detection_classification_pairs = []
                                for det in pv_dets:
                                    bbox_n = det.bbox_normalized
                                    pixel_bbox = {
                                        'x': int(bbox_n[0] * det.image_width),
                                        'y': int(bbox_n[1] * det.image_height),
                                        'width': int(bbox_n[2] * det.image_width),
                                        'height': int(bbox_n[3] * det.image_height)
                                    }
                                    ann_det = AnnotatedDetection(bbox=pixel_bbox, category=det.category)
                                    ann_class = AnnotatedClassification(
                                        species=det.category, confidence=det.confidence
                                    )
                                    detection_classification_pairs.append((ann_det, ann_class))

                                if detection_classification_pairs:
                                    annotated_bytes = generate_annotated_image(
                                        image_path=image_path,
                                        detections=detection_classification_pairs
                                    )
                                    annotated_minio_path = upload_annotated_image_to_minio(
                                        image_bytes=annotated_bytes,
                                        image_uuid=image_uuid
                                    )
                            except Exception as e:
                                logger.warning(
                                    "Failed to generate annotated image for pv notifications",
                                    error=str(e)
                                )

                            publish_person_vehicle_events(
                                camera, image_record, image_uuid, pv_dets,
                                annotated_minio_path, message.get("timestamp")
                            )
                        except Exception as e:
                            logger.error("Failed to publish pv notification event", error=str(e))

            logger.info("Image processing complete (no animals)", image_uuid=image_uuid)
            return

        # The project's classification config is read only now, after every
        # early return, so images without animals never depend on it.
        taxonomy_map, geofencing_config = get_project_species_config(project_id)

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

        # Step 4: Run classification on animal detections
        classifications = run_classification(classifier, image_path, detections, taxonomy_map, ensemble, geofencing_config)

        logger.info(
            "Classifications generated",
            image_uuid=image_uuid,
            num_classifications=len(classifications)
        )

        # Step 5: Insert classifications into database
        classification_ids = insert_classifications(classifications)

        # Step 6: Update image status to classified
        update_image_status(image_uuid, "classified")

        # Step 6.5: Publish notification events for each unique species detected.
        # Suppressed for bulk uploads: an SD-card import would otherwise
        # fire thousands of stale species_detection alerts at once.
        if classifications and not is_bulk:
            try:
                # Build detection confidence lookup for threshold filtering
                detection_confidence = {d.detection_id: d.confidence for d in detections}

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

                        # Filter classifications by parent detection confidence vs project threshold
                        det_threshold = project.detection_threshold if project else 0
                        species_map = {}
                        species_counts = {}
                        for classification in classifications:
                            det_conf = detection_confidence.get(classification.detection_id, 0)
                            if det_conf < det_threshold:
                                continue
                            species = classification.species
                            species_counts[species] = species_counts.get(species, 0) + 1
                            if species not in species_map or classification.confidence > species_map[species].confidence:
                                species_map[species] = classification

                        if not species_map:
                            logger.info(
                                "All detections below threshold, skipping notifications",
                                image_uuid=image_uuid,
                                detection_threshold=det_threshold
                            )
                        else:
                            blur_cats = project.blur_categories() if project else []
                            if blur_cats:
                                pv_dets = db.query(DetectionModel).filter(
                                    DetectionModel.image_id == image.id,
                                    DetectionModel.category.in_(blur_cats),
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
                                            region = region.filter(ImageFilter.GaussianBlur(radius=25))
                                            img.paste(region, (x1, y1))
                                    img.save(image_path, format='JPEG', quality=90)
                                    logger.info("Applied privacy blur", image_uuid=image_uuid, num_blurred=len(pv_dets))

                            # Collect above-threshold person/vehicle detections for annotation + notification
                            pv_above = [d for d in detections
                                        if d.category in ('person', 'vehicle') and d.confidence >= det_threshold]

                            try:
                                # Build detection/classification pairs for annotation
                                # Only include detections above the detection threshold
                                detection_classification_pairs = []
                                for classification in classifications:
                                    # Find matching detection
                                    matching_det = next(
                                        (d for d in detections if d.detection_id == classification.detection_id),
                                        None
                                    )
                                    if matching_det and matching_det.confidence >= det_threshold:
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

                                # Include person/vehicle detections in annotation
                                for det in pv_above:
                                    bbox_n = det.bbox_normalized
                                    pixel_bbox = {
                                        'x': int(bbox_n[0] * det.image_width),
                                        'y': int(bbox_n[1] * det.image_height),
                                        'width': int(bbox_n[2] * det.image_width),
                                        'height': int(bbox_n[3] * det.image_height)
                                    }
                                    ann_det = AnnotatedDetection(bbox=pixel_bbox, category=det.category)
                                    ann_class = AnnotatedClassification(
                                        species=det.category, confidence=det.confidence
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

                            # Where and when from the photo's own EXIF, not the camera row
                            location, timestamp = event_location_and_timestamp(
                                image, message.get("timestamp")
                            )

                            notification_queue = RedisQueue(QUEUE_NOTIFICATION_EVENTS)

                            # Publish one notification per unique species
                            for species, classification in species_map.items():
                                notification_queue.publish({
                                    "event_type": "species_detection",
                                    "project_id": camera.project_id,
                                    "image_uuid": image_uuid,
                                    "camera_id": camera.id,
                                    "camera_name": camera.device_id,
                                    "camera_location": location,
                                    "species": species,
                                    "confidence": classification.confidence,
                                    "detection_confidence": detection_confidence.get(classification.detection_id, 0),
                                    "detection_count": len(classifications),
                                    "species_count": species_counts[species],
                                    "annotated_minio_path": annotated_minio_path,
                                    "timestamp": timestamp
                                })
                                logger.info(
                                    "Published species detection notification",
                                    species=species,
                                    confidence=classification.confidence,
                                    total_species_count=len(species_map),
                                    annotated_minio_path=annotated_minio_path
                                )

                            # Also publish notifications for person/vehicle detections
                            if pv_above:
                                publish_person_vehicle_events(
                                    camera, image, image_uuid, pv_above,
                                    annotated_minio_path, message.get("timestamp")
                                )
            except Exception as e:
                logger.error("Failed to publish notification event", error=str(e))

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
    """Main entry point for SpeciesNet classification worker"""
    logger.info("SpeciesNet classification worker starting", log_level=settings.log_level)

    # Decide the device before the model download, so a GPU server that
    # cannot see its card fails in a second instead of after the download.
    device = select_device(settings.use_gpu, torch.cuda.is_available())
    logger.info("Loading SpeciesNet model", device=device)
    classifier, ensemble = load_model(device)
    logger.info("Model loaded successfully")

    # Initialize queue consumer. Priority BRPOP keeps live ahead of bulk.
    queue = RedisQueue(QUEUE_DETECTION_COMPLETE)
    queue.record_device(DEVICE_KEY_CLASSIFICATION, device)
    priority_queues = [QUEUE_DETECTION_COMPLETE, QUEUE_DETECTION_COMPLETE_BULK]

    # Process messages forever. Each image reads its own project's config.
    def handle_message(msg):
        process_detection_complete(msg, classifier, ensemble)
        # Only reached when classification succeeded (it raises on failure).
        if msg.get("origin") == "bulk":
            tier_bulk_raw_cold(msg.get("image_uuid"))

    logger.info("Listening for messages", queues=priority_queues)
    queue.consume_forever_priority(
        priority_queues, handle_message, heartbeat_key=HEARTBEAT_KEY_CLASSIFICATION
    )


if __name__ == "__main__":
    main()
