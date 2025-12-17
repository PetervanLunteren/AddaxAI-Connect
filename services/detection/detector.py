"""
Detection inference logic

Runs MegaDetector inference and processes results using official MegaDetector API.
"""
from PIL import Image
from typing import Any

from shared.logger import get_logger
from config import get_settings

logger = get_logger("detection.detector")
settings = get_settings()

# MegaDetector category mapping
CATEGORY_MAP = {
    "1": "animal",
    "2": "person",
    "3": "vehicle"
}


class Detection:
    """Detection result"""
    def __init__(
        self,
        category: str,
        confidence: float,
        bbox_normalized: list[float],
        bbox_pixels: list[int],
        image_width: int,
        image_height: int
    ):
        self.category = category
        self.confidence = confidence
        self.bbox_normalized = bbox_normalized  # [x_min, y_min, width, height] 0-1
        self.bbox_pixels = bbox_pixels  # [x_min, y_min, width, height] pixels
        self.image_width = image_width
        self.image_height = image_height

    def to_dict(self) -> dict:
        """Convert to dict for database storage"""
        return {
            "category": self.category,
            "confidence": self.confidence,
            "bbox_normalized": self.bbox_normalized,
            "bbox_pixels": self.bbox_pixels,
        }


def run_detection(
    detector: Any,
    image_path: str
) -> list[Detection]:
    """
    Run MegaDetector inference on image using official API.

    Args:
        detector: Loaded MegaDetector PTDetector model
        image_path: Path to image file

    Returns:
        List of Detection objects

    Raises:
        Exception: If inference fails
    """
    logger.info("Running detection", image_path=image_path)

    try:
        # Load image
        image = Image.open(image_path)
        image_width, image_height = image.size

        # Run inference using MegaDetector API
        # The detector.generate_detections_one_image() method returns a dict with:
        # {
        #   "file": image_path,
        #   "max_detection_conf": float,
        #   "detections": [
        #     {
        #       "category": "1" | "2" | "3",
        #       "conf": float,
        #       "bbox": [x_min_norm, y_min_norm, width_norm, height_norm]
        #     }, ...
        #   ]
        # }
        result = detector.generate_detections_one_image(
            image,
            image_path,
            detection_threshold=settings.confidence_threshold
        )

        # Parse results
        detections = []
        for det in result["detections"]:
            # MegaDetector returns bbox in [x_min, y_min, width, height] normalized format
            bbox_normalized = det["bbox"]
            conf = det["conf"]
            category_id = det["category"]

            # Get category name
            category = CATEGORY_MAP.get(category_id, "unknown")

            # Convert to pixel coordinates
            x_min_norm, y_min_norm, width_norm, height_norm = bbox_normalized
            bbox_pixels = [
                int(x_min_norm * image_width),
                int(y_min_norm * image_height),
                int(width_norm * image_width),
                int(height_norm * image_height)
            ]

            detection = Detection(
                category=category,
                confidence=conf,
                bbox_normalized=bbox_normalized,
                bbox_pixels=bbox_pixels,
                image_width=image_width,
                image_height=image_height
            )

            detections.append(detection)

        logger.info(
            "Detection complete",
            image_path=image_path,
            num_detections=len(detections),
            categories={d.category for d in detections}
        )

        return detections

    except Exception as e:
        logger.error("Detection failed", image_path=image_path, error=str(e), exc_info=True)
        raise
