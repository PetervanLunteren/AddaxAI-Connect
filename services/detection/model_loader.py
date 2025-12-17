"""
MegaDetector v1000 Redwood model loader

Handles model initialization using official MegaDetector package.
"""
import torch
from typing import Any

from megadetector.detection import load_detector

from shared.logger import get_logger

logger = get_logger("detection.model_loader")


def detect_device() -> str:
    """
    Configure CPU device for inference.

    Returns:
        str: Device string ('cpu')
    """
    logger.info("Using CPU for inference")
    return "cpu"


def load_model() -> tuple[Any, str]:
    """
    Load MegaDetector v1000 Redwood model using official package.

    Downloads model if not cached locally and loads using MegaDetector API.

    Returns:
        tuple: (model, device)

    Raises:
        Exception: If model loading fails
    """
    # Detect device
    device = detect_device()

    # Load model using MegaDetector package
    logger.info("Loading MegaDetector model", model_alias="MD1000-redwood")

    try:
        # Load using official MegaDetector API with model alias
        model = load_detector("MD1000-redwood", device=device)

        logger.info("Model loaded successfully", device=device)

        # Warmup inference
        logger.info("Performing warmup inference")
        import numpy as np
        from PIL import Image

        # Create dummy image
        dummy_img_array = np.zeros((640, 640, 3), dtype=np.uint8)
        dummy_img = Image.fromarray(dummy_img_array)

        with torch.no_grad():
            _ = model.generate_detections_one_image(dummy_img)

        logger.info("Warmup complete")

        return model, device

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
