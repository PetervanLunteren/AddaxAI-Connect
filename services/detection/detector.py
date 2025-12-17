"""
Detection inference logic

Runs MegaDetector inference and processes results.
"""
import torch
import numpy as np
from PIL import Image
from typing import Any
from pathlib import Path

from shared.logger import get_logger
from config import get_settings

logger = get_logger("detection.detector")
settings = get_settings()

# MegaDetector category mapping
CATEGORY_MAP = {
    0: "animal",
    1: "person",
    2: "vehicle"
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
    model: Any,
    device: torch.device,
    image_path: str
) -> list[Detection]:
    """
    Run MegaDetector inference on image.

    Args:
        model: Loaded YOLO model
        device: Torch device (CPU or CUDA)
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

        # Run inference
        results = model(image_path, conf=settings.confidence_threshold, verbose=False)

        # Parse results
        detections = []
        for result in results:
            boxes = result.boxes

            for i in range(len(boxes)):
                # Get box coordinates (xyxy format)
                xyxy = boxes.xyxy[i].cpu().numpy()
                conf = float(boxes.conf[i].cpu().numpy())
                cls = int(boxes.cls[i].cpu().numpy())

                # Convert to MegaDetector format [x_min, y_min, width, height]
                x_min = float(xyxy[0])
                y_min = float(xyxy[1])
                x_max = float(xyxy[2])
                y_max = float(xyxy[3])

                width = x_max - x_min
                height = y_max - y_min

                # Normalized coordinates (0-1)
                bbox_normalized = [
                    x_min / image_width,
                    y_min / image_height,
                    width / image_width,
                    height / image_height
                ]

                # Pixel coordinates
                bbox_pixels = [
                    int(x_min),
                    int(y_min),
                    int(width),
                    int(height)
                ]

                # Get category name
                category = CATEGORY_MAP.get(cls, "unknown")

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
