#!/usr/bin/env python3
"""
Republish pending images to the detection queue.

This script finds all images with status='pending' and republishes them
to the QUEUE_IMAGE_INGESTED so they can be processed by the detection service.
"""
import sys
sys.path.insert(0, '/app')
sys.path.insert(0, '/shared')

from shared.database import get_db_session
from shared.models import Image
from shared.queue import RedisQueue, QUEUE_IMAGE_INGESTED
from shared.logger import get_logger

logger = get_logger("republish_pending")


def main():
    """Main entry point"""
    logger.info("Starting republish of pending images")

    with get_db_session() as session:
        # Find all pending images
        pending_images = session.query(Image).filter(
            Image.status == 'pending'
        ).all()

        logger.info(f"Found {len(pending_images)} pending images")

        if len(pending_images) == 0:
            logger.info("No pending images to republish")
            return

        # Initialize queue
        queue = RedisQueue(QUEUE_IMAGE_INGESTED)

        # Republish each image
        republished = 0
        for image in pending_images:
            try:
                queue.publish({
                    'image_uuid': image.uuid,
                    'storage_path': image.storage_path,
                    'camera_id': image.camera_id,
                })
                republished += 1
                logger.info(
                    "Republished image",
                    image_uuid=image.uuid,
                    filename=image.filename
                )
            except Exception as e:
                logger.error(
                    "Failed to republish image",
                    image_uuid=image.uuid,
                    error=str(e)
                )

        logger.info(
            "Republish complete",
            total_pending=len(pending_images),
            republished=republished
        )


if __name__ == "__main__":
    main()
