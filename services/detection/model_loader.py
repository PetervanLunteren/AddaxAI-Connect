"""
MegaDetector v1000 Redwood model loader

Handles model initialization using official MegaDetector package.
"""
from typing import Any

from megadetector.detection.run_detector import load_detector

from shared.logger import get_logger

logger = get_logger("detection.model_loader")


def load_model() -> Any:
    """
    Load MegaDetector v1000 Redwood model using official package.

    Downloads model if not cached locally and loads using MegaDetector API.

    Returns:
        PTDetector: Loaded MegaDetector model

    Raises:
        Exception: If model loading fails
    """
    # Load model using MegaDetector package
    logger.info("Loading MegaDetector model", model_alias="MD1000-redwood")

    try:
        # Load using official MegaDetector API with model alias
        # force_cpu=True ensures CPU-only inference
        detector = load_detector("MD1000-redwood", force_cpu=True)

        logger.info("Model loaded successfully", device="cpu")

        # Note: MegaDetector performs warmup automatically during load

        return detector

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
