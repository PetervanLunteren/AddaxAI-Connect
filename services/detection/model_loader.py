"""
MegaDetector v1000 Redwood model loader

Handles model download, caching, and initialization with GPU/CPU auto-detection.
"""
import os
import torch
import urllib.request
from pathlib import Path
from typing import Any

from shared.logger import get_logger
from config import get_settings

logger = get_logger("detection.model_loader")
settings = get_settings()


def download_model(url: str, dest_path: str) -> None:
    """
    Download model from URL to destination path.

    Args:
        url: Model download URL
        dest_path: Destination file path

    Raises:
        Exception: If download fails
    """
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    logger.info("Downloading MegaDetector model", url=url, dest=dest_path)

    try:
        urllib.request.urlretrieve(url, dest_path)
        logger.info("Model download complete", size_mb=dest.stat().st_size / (1024 * 1024))
    except Exception as e:
        logger.error("Model download failed", url=url, error=str(e), exc_info=True)
        raise


def detect_device() -> torch.device:
    """
    Configure CPU device for inference.

    Returns:
        torch.device: CPU device

    """
    logger.info("Using CPU for inference")
    return torch.device("cpu")


def load_model() -> tuple[Any, torch.device]:
    """
    Load MegaDetector v1000 Redwood model.

    Downloads model if not cached locally, detects GPU/CPU,
    loads model and performs warmup inference.

    Returns:
        tuple: (model, device)

    Raises:
        Exception: If model loading fails
    """
    model_path = Path(settings.detection_model_path)

    # Download model if not cached
    if not model_path.exists():
        logger.info("Model not found locally, downloading", path=str(model_path))
        download_model(settings.detection_model_url, str(model_path))
    else:
        logger.info("Using cached model", path=str(model_path))

    # Detect device
    device = detect_device()

    # Load model directly with PyTorch (YOLOv5)
    logger.info("Loading MegaDetector model", path=str(model_path))

    try:
        # Load checkpoint with torch
        checkpoint = torch.load(str(model_path), map_location=device)

        # Extract model from checkpoint
        if isinstance(checkpoint, dict) and 'model' in checkpoint:
            model = checkpoint['model'].float()
        else:
            model = checkpoint.float()

        model.to(device)
        model.eval()

        logger.info("Model loaded successfully", device=str(device), model_type=type(model).__name__)

        # Warmup inference
        logger.info("Performing warmup inference")
        dummy_input = torch.randn(1, 3, 640, 640).to(device)
        with torch.no_grad():
            _ = model(dummy_input)
        logger.info("Warmup complete")

        return model, device

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
