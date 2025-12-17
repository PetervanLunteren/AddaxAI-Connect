"""
DeepFaune v1.4 model loader

Handles model initialization using Vision Transformer with DINOv2 backbone.
Downloads model to persistent storage to avoid re-downloading on container restart.
"""
import os
import requests
import torch
import timm
from pathlib import Path
from typing import Any

from shared.logger import get_logger
from config import get_settings

logger = get_logger("classification.model_loader")
settings = get_settings()

# DeepFaune v1.4 species classes (38 European wildlife species)
DEEPFAUNE_CLASSES = [
    "bison", "badger", "ibex", "beaver", "roe_deer", "fallow_deer", "red_deer",
    "sika_deer", "marmot", "chamois", "cat", "dog", "squirrel", "blackbird",
    "pheasant", "fox", "hare", "human", "mouflon", "marten", "nutria",
    "bird", "raptor", "field_mouse", "rat", "wild_boar", "raccoon",
    "raccoon_dog", "skunk", "hedgehog", "undefined", "weasel", "empty",
    "small_rodent", "muskrat", "livestock", "wolf", "otter"
]


def download_model_if_needed() -> str:
    """
    Download DeepFaune model to persistent storage if not already cached.

    Uses the /models volume mount to persist the model across container restarts.

    Returns:
        str: Path to the downloaded model file

    Raises:
        Exception: If download fails
    """
    model_path = Path(settings.classification_model_path)
    model_url = settings.classification_model_url

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
        response = requests.get(model_url, stream=True, timeout=300)
        response.raise_for_status()

        total_size = int(response.headers.get('content-length', 0))
        logger.info(
            "Starting download",
            total_size_mb=round(total_size / 1024 / 1024, 2) if total_size else "unknown"
        )

        with open(model_path, 'wb') as f:
            downloaded = 0
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)

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
    Load DeepFaune v1.4 ViT-Large model with DINOv2 backbone.

    Downloads model to persistent storage if not cached, then loads using timm.

    Returns:
        torch.nn.Module: Loaded DeepFaune classifier model

    Raises:
        Exception: If model loading or download fails
    """
    logger.info("Loading DeepFaune v1.4 model", architecture="vit_large_patch14_dinov2")

    try:
        # Download model to persistent storage if needed
        model_path = download_model_if_needed()

        # Determine device (CPU only for now, matching detection worker)
        device = torch.device("cpu")
        logger.info("Using device", device=str(device))

        # Create ViT-Large model with DINOv2 backbone
        # Architecture: vit_large_patch14_dinov2.lvd142m
        # Note: dynamic_img_size=True allows 182x182 inputs despite 518x518 architecture
        model = timm.create_model(
            'vit_large_patch14_dinov2.lvd142m',
            pretrained=False,  # Don't load ImageNet weights
            num_classes=len(DEEPFAUNE_CLASSES),
            dynamic_img_size=True  # Allow flexible input dimensions
        )

        # Load DeepFaune weights
        logger.info("Loading model weights", model_path=model_path)
        checkpoint = torch.load(model_path, map_location=device)

        # Handle nested state dict (checkpoint may have 'state_dict', 'model', or weights directly)
        if 'state_dict' in checkpoint:
            state_dict = checkpoint['state_dict']
        elif 'model' in checkpoint:
            state_dict = checkpoint['model']
        else:
            state_dict = checkpoint

        # Remove "base_model." prefix if present (DeepFaune wraps model)
        if any(k.startswith('base_model.') for k in state_dict.keys()):
            state_dict = {k.replace('base_model.', ''): v for k, v in state_dict.items() if k.startswith('base_model.')}
            logger.info("Removed base_model prefix from state dict keys")

        model.load_state_dict(state_dict)

        # Set to evaluation mode
        model.eval()
        model.to(device)

        logger.info(
            "Model loaded successfully",
            device=str(device),
            num_classes=len(DEEPFAUNE_CLASSES),
            model_path=model_path
        )

        return model

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
