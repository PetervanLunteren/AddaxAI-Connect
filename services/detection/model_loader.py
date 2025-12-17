"""
MegaDetector v1000 Redwood model loader

Handles model initialization using official MegaDetector package.
Downloads model to persistent storage to avoid re-downloading on container restart.
"""
import os
from pathlib import Path
from typing import Any

from megadetector.detection.run_detector import load_detector
from megadetector.utils import url_utils

from shared.logger import get_logger
from config import get_settings

logger = get_logger("detection.model_loader")
settings = get_settings()


def download_model_if_needed() -> str:
    """
    Download MegaDetector model to persistent storage if not already cached.

    Uses the /models volume mount to persist the model across container restarts.

    Returns:
        str: Path to the downloaded model file

    Raises:
        Exception: If download fails
    """
    model_path = Path(settings.detection_model_path)
    model_url = settings.detection_model_url

    # Create parent directory if it doesn't exist
    model_path.parent.mkdir(parents=True, exist_ok=True)

    if model_path.exists():
        logger.info(
            "Model already cached",
            model_path=str(model_path),
            size_mb=round(model_path.stat().st_size / 1024 / 1024, 2)
        )
        return str(model_path)

    # Download model to persistent storage
    logger.info(
        "Downloading model to persistent storage",
        model_url=model_url,
        model_path=str(model_path)
    )

    try:
        url_utils.download_url(
            url=model_url,
            destination_filename=str(model_path),
            verbose=True
        )

        logger.info(
            "Model downloaded successfully",
            model_path=str(model_path),
            size_mb=round(model_path.stat().st_size / 1024 / 1024, 2)
        )

        return str(model_path)

    except Exception as e:
        logger.error("Model download failed", error=str(e), exc_info=True)
        # Clean up partial download
        if model_path.exists():
            model_path.unlink()
        raise


def load_model() -> Any:
    """
    Load MegaDetector v1000 Redwood model using official package.

    Downloads model to persistent storage if not cached, then loads using MegaDetector API.

    Returns:
        PTDetector: Loaded MegaDetector model

    Raises:
        Exception: If model loading or download fails
    """
    logger.info("Loading MegaDetector model", model_alias="MD1000-redwood")

    try:
        # Download model to persistent storage if needed
        model_path = download_model_if_needed()

        # Load using official MegaDetector API with explicit path
        # force_cpu=True ensures CPU-only inference
        detector = load_detector(model_path, force_cpu=True)

        logger.info("Model loaded successfully", device="cpu", model_path=model_path)

        # Note: MegaDetector performs warmup automatically during load

        return detector

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
