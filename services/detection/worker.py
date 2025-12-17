"""
Detection Worker

Consumes images from the ingestion queue, runs object detection, and produces crops.
"""
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

from shared.logger import get_logger, set_image_id
from shared.queue import RedisQueue, QUEUE_IMAGE_INGESTED, QUEUE_DETECTION_COMPLETE
from config import get_settings
from model_loader import load_model
from detector import run_detection
from cropper import crop_detection, generate_crop_filename
from storage_operations import download_image_from_minio, upload_crop_to_minio
from db_operations import update_image_status, insert_detections

logger = get_logger("detection")
settings = get_settings()


def process_image(message: dict, detector) -> None:
    """
    Process image through detection pipeline.

    Args:
        message: Queue message with image metadata
        detector: Loaded MegaDetector model

    Raises:
        Exception: If processing fails (crashes worker)
    """
    image_uuid = message.get("image_uuid")
    storage_path = message.get("storage_path")
    camera_id = message.get("camera_id")

    if not image_uuid or not storage_path:
        raise ValueError(f"Invalid message format: {message}")

    # Set correlation ID for logging
    set_image_id(image_uuid)

    logger.info(
        "Processing image",
        image_uuid=image_uuid,
        storage_path=storage_path,
        camera_id=camera_id
    )

    temp_files = []

    try:
        # Step 1: Update status to processing
        update_image_status(image_uuid, "processing")

        # Step 2: Download image from MinIO
        image_path = download_image_from_minio(storage_path)
        temp_files.append(image_path)

        # Step 3: Run detection
        detections = run_detection(detector, image_path)

        logger.info(
            "Detections found",
            image_uuid=image_uuid,
            num_detections=len(detections)
        )

        # If no detections, update status and publish message
        if len(detections) == 0:
            logger.info("No detections found, skipping crop generation", image_uuid=image_uuid)
            update_image_status(image_uuid, "detected")

            # Publish to next queue (classification will handle empty detections)
            queue = RedisQueue(QUEUE_DETECTION_COMPLETE)
            queue.publish({
                "image_uuid": image_uuid,
                "num_detections": 0,
                "detection_ids": []
            })

            logger.info("Image processing complete (no detections)", image_uuid=image_uuid)
            return

        # Step 4: Generate and upload crops
        crop_paths = []
        for idx, detection in enumerate(detections):
            # Generate crop filename
            crop_filename = generate_crop_filename(image_uuid, idx)

            # Create temporary crop file
            temp_crop = NamedTemporaryFile(delete=False, suffix=".jpg")
            temp_crop_path = temp_crop.name
            temp_crop.close()
            temp_files.append(temp_crop_path)

            # Crop detection
            crop_detection(image_path, detection, temp_crop_path)

            # Upload to MinIO
            crop_storage_path = upload_crop_to_minio(temp_crop_path, crop_filename)
            crop_paths.append(crop_storage_path)

        logger.info(
            "Crops generated and uploaded",
            image_uuid=image_uuid,
            num_crops=len(crop_paths)
        )

        # Step 5: Insert detections into database
        detection_ids = insert_detections(image_uuid, detections, crop_paths)

        # Step 6: Update image status to detected
        update_image_status(image_uuid, "detected")

        # Step 7: Publish to detection-complete queue
        queue = RedisQueue(QUEUE_DETECTION_COMPLETE)
        queue.publish({
            "image_uuid": image_uuid,
            "num_detections": len(detections),
            "detection_ids": detection_ids,
            "crop_paths": crop_paths
        })

        logger.info(
            "Image processing complete",
            image_uuid=image_uuid,
            num_detections=len(detections),
            detection_ids=detection_ids
        )

    except Exception as e:
        # Update status to failed
        try:
            update_image_status(image_uuid, "failed")
        except Exception as db_error:
            logger.error("Failed to update status to failed", error=str(db_error))

        logger.error(
            "Image processing failed",
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
    """Main entry point for detection worker"""
    logger.info("Detection worker starting", log_level=settings.log_level)

    # Load model on startup
    logger.info("Loading MegaDetector model")
    detector = load_model()
    logger.info("Model loaded successfully")

    # Initialize queue consumer
    queue = RedisQueue(QUEUE_IMAGE_INGESTED)

    # Process messages forever
    logger.info("Listening for messages", queue=QUEUE_IMAGE_INGESTED)
    queue.consume_forever(lambda msg: process_image(msg, detector))


if __name__ == "__main__":
    main()
