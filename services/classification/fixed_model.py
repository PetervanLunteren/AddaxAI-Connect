"""
Fixed-class models, run through the model's own inference.py.

Every fixed-class model in the catalog ships an inference.py on HuggingFace
with the contract AddaxAI desktop runs (backend/templates/inference_template.py
there): a ModelInference class with check_gpu, load_model, get_crop,
get_classification and get_class_names. Running that script, instead of a
copy of its preprocessing here, means Connect and the desktop app give the
same answer for the same crop, and adding a model is a catalog entry.

The script picks its own device (CUDA when it can see a card), the same as
on desktop. Class names are stored as labels in lowercase with underscores,
and the script's names must match the model's vendored taxonomy.csv, which
the API and the notifications read; a mismatch fails the load.
"""
import importlib.util
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image

from shared.classification_models import ClassificationModel, class_labels, normalise_label
from shared.logger import get_logger

from records import Classification, DetectionInfo, ProjectConfig

logger = get_logger("classification.fixed_model")

CONTRACT = ("check_gpu", "load_model", "get_crop", "get_classification", "get_class_names")


def load_inference(model_dir: Path, weights_file: str) -> Any:
    """The model's ModelInference instance, from its inference.py."""
    module_name = "inference_" + model_dir.name.replace("-", "_").replace(".", "_")
    spec = importlib.util.spec_from_file_location(module_name, model_dir / "inference.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    missing = [name for name in CONTRACT if not callable(getattr(module.ModelInference, name, None))]
    if missing:
        raise RuntimeError(f"{model_dir.name}/inference.py lacks {', '.join(missing)}")
    return module.ModelInference(model_dir, model_dir / weights_file)


def pick_species(probabilities: Dict[str, float], included_species: Optional[List[str]]) -> tuple[str, float]:
    """The top-1 label and its probability renormalised over the project's
    included species. With no list every label counts. A list that leaves
    nothing falls back to every label, so a crop always gets an answer."""
    allowed = {
        label: p for label, p in probabilities.items()
        if included_species is None or label in included_species
    }
    if not allowed:
        allowed = probabilities
    label = max(allowed, key=allowed.get)
    total = sum(allowed.values())
    return label, (allowed[label] / total if total > 0 else 0.0)


class FixedModel:
    def __init__(self, model: ClassificationModel, inference: Any):
        self.model = model
        self.inference = inference

    def classify(
        self, image_path: str, detections: List[DetectionInfo], project: ProjectConfig
    ) -> List[Classification]:
        """Top-1 per animal detection."""
        image = Image.open(image_path).convert("RGB")
        results = []
        for detection in (d for d in detections if d.category == "animal"):
            crop = self.inference.get_crop(image, tuple(detection.bbox_normalized))
            probabilities = {
                normalise_label(name): float(p) for name, p in self.inference.get_classification(crop)
            }
            species, confidence = pick_species(probabilities, project.included_species)
            results.append(Classification(detection.detection_id, species, confidence))
            logger.info(
                "Classification complete",
                model=self.model.id, detection_id=detection.detection_id,
                species=species, confidence=round(confidence, 4),
            )
        return results


def load(model: ClassificationModel, model_dir: Path, device: str) -> FixedModel:
    inference = load_inference(model_dir, model.weights_file)
    inference.check_gpu()
    inference.load_model()
    names = {normalise_label(name) for name in inference.get_class_names().values()}
    expected = set(class_labels(model.id))
    if names != expected:
        raise RuntimeError(
            f"{model.id}: inference.py class names differ from taxonomy.csv: {sorted(names ^ expected)}"
        )
    return FixedModel(model, inference)
