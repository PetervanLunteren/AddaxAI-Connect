"""
SpeciesNet model loader

Downloads model from HuggingFace and patches info.json to prevent
unnecessary MegaDetector download. We only use the classifier component.
"""
import json
from pathlib import Path
from typing import Any

from huggingface_hub import snapshot_download

from shared.logger import get_logger
from config import get_settings

logger = get_logger("classification-speciesnet.model_loader")
settings = get_settings()


def download_model_if_needed() -> str:
    """
    Download SpeciesNet model from HuggingFace to persistent storage if not already cached.

    Returns:
        str: Path to the local model directory

    Raises:
        Exception: If download fails
    """
    model_dir = Path(settings.speciesnet_model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)

    info_json = model_dir / "info.json"

    if info_json.exists():
        logger.info(
            "Model already cached",
            model_dir=str(model_dir)
        )
        return str(model_dir)

    logger.info(
        "Downloading SpeciesNet model from HuggingFace",
        repo=settings.speciesnet_hf_repo,
        model_dir=str(model_dir)
    )

    try:
        snapshot_download(
            repo_id=settings.speciesnet_hf_repo,
            local_dir=str(model_dir),
            local_dir_use_symlinks=False
        )

        logger.info(
            "Model downloaded successfully",
            model_dir=str(model_dir)
        )

        return str(model_dir)

    except Exception as e:
        logger.error("Model download failed", error=str(e), exc_info=True)
        raise


def patch_info_json(model_dir: str) -> None:
    """
    Patch info.json to replace detector URL with a local dummy path.

    SpeciesNet's ModelInfo reads info.json and downloads MegaDetector (~150MB)
    if the detector field is a URL. Since we only use the classifier and already
    have our own MegaDetector, we replace it with a dummy file.

    Args:
        model_dir: Path to the local model directory
    """
    info_path = Path(model_dir) / "info.json"

    if not info_path.exists():
        logger.warning("info.json not found, skipping patch", model_dir=model_dir)
        return

    try:
        with open(info_path) as f:
            info = json.load(f)

        original_detector = info.get("detector")

        if original_detector and (
            isinstance(original_detector, str) and original_detector.startswith("http")
        ):
            dummy_path = Path(model_dir) / "dummy_detector.pt"
            dummy_path.touch()

            info["detector"] = str(dummy_path)

            with open(info_path, "w") as f:
                json.dump(info, f, indent=2)

            logger.info(
                "Patched info.json to prevent MegaDetector download",
                original_detector=original_detector,
                dummy_path=str(dummy_path)
            )
        else:
            logger.info(
                "Detector field is not a URL, no patching needed",
                detector=original_detector
            )

    except Exception as e:
        logger.error("Failed to patch info.json", error=str(e), exc_info=True)
        raise


def load_ensemble(model_dir: str) -> Any:
    """
    Load SpeciesNet ensemble for geofencing and taxonomic rollup.

    Always loaded. Country code is read from the database per-classification,
    not at load time.

    Returns:
        SpeciesNetEnsemble instance
    """
    from speciesnet import SpeciesNetEnsemble

    ensemble = SpeciesNetEnsemble(model_name=model_dir, geofence=True)
    logger.info("Ensemble loaded for geofencing")
    return ensemble


def load_model() -> tuple[Any, Any]:
    """
    Load SpeciesNet classifier and ensemble.

    Downloads model from HuggingFace if not cached, patches info.json to
    prevent MegaDetector download, then instantiates both components.

    Returns:
        Tuple of (SpeciesNetClassifier, SpeciesNetEnsemble)

    Raises:
        Exception: If model loading or download fails
    """
    logger.info("Loading SpeciesNet model", hf_repo=settings.speciesnet_hf_repo)

    try:
        model_dir = download_model_if_needed()
        patch_info_json(model_dir)

        from speciesnet import SpeciesNetClassifier

        classifier = SpeciesNetClassifier(model_name=model_dir, device="cpu")
        ensemble = load_ensemble(model_dir)

        logger.info("SpeciesNet model loaded successfully", model_dir=model_dir)

        return classifier, ensemble

    except Exception as e:
        logger.error("Model loading failed", error=str(e), exc_info=True)
        raise
