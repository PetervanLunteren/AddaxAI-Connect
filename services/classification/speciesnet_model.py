"""
SpeciesNet, through Google's speciesnet package.

Runs SpeciesNet inference on animal detections and processes results. The
model folder comes from the registry (the catalog's pinned HuggingFace
commit); info.json is patched so the package does not download its own
MegaDetector, which Connect's detection worker already runs.

Per detection this follows the reference pipeline for detection-level
SpeciesNet, `_process_classification_batch` in MegaDetector's
`megadetector/detection/run_md_and_speciesnet.py`, the way it runs with a
custom taxa list: no geofence, the taxonomic rollup, then the project's
label CSV. A country geofence would roll an out-of-range species up to a
broad group before the CSV sees it, and the CSV is what narrows the labels
to the place. The rollup is the public function of the speciesnet package.
The ensemble's `combine()` is deliberately not used: it picks one label for
a whole image and mixes in detector-confidence rules for people, vehicles
and blanks, which do not belong on a single detection.
"""
import json
from pathlib import Path
from PIL import Image
from typing import Any, List

from speciesnet import BBox, SpeciesNetClassifier, SpeciesNetEnsemble
from speciesnet.geofence_utils import roll_up_labels_to_first_matching_level

from shared.classification_models import ClassificationModel, speciesnet_taxa, taxon_names
from shared.logger import get_logger
from shared.taxonomy import apply_taxonomy_walkup
from db_operations import get_project_taxonomy_map
from records import Classification, DetectionInfo, ProjectConfig

logger = get_logger("classification.speciesnet_model")

# Same values as run_md_and_speciesnet (DEFAULT_ROLLUP_TARGET_CONFIDENCE and
# the levels it passes), so a detection gets the label the reference
# pipeline would give it.
ROLLUP_TARGET_CONFIDENCE = 0.65
ROLLUP_LEVELS = ["species", "genus", "family", "order", "class", "kingdom"]


def roll_up(classes: List[str], scores: List[float], ensemble: Any) -> tuple[str, float]:
    """Label and score for one detection from the classifier's top-5.

    The confidence rollup of run_md_and_speciesnet, without a geofence: the
    first level, from species up, where the summed scores pass the
    threshold. A rollup that finds no such level keeps the top-1.
    """
    rollup = roll_up_labels_to_first_matching_level(
        labels=classes,
        scores=scores,
        country=None,
        admin1_region=None,
        target_taxonomy_levels=ROLLUP_LEVELS,
        non_blank_threshold=ROLLUP_TARGET_CONFIDENCE,
        taxonomy_map=ensemble.taxonomy_map,
        geofence_map=ensemble.geofence_map,
        enable_geofence=False,
    )
    if rollup is not None:
        label, score, _ = rollup
        return label, score

    return classes[0], scores[0]


def read_top5(result: dict[str, Any]) -> tuple[List[str], List[float]]:
    """Classes and scores of the classifier's top-5 for one detection.

    The pinned speciesnet answers every preprocessed image with a top-5.
    Anything else is a failure or a changed package (5.0.6 moved it to
    classifications_list, issue #98), never an animal the model does not
    know, so it stops the image.
    """
    top5 = result.get("classifications") or {}
    classes, scores = top5.get("classes"), top5.get("scores")
    if not classes or not scores:
        raise RuntimeError(f"SpeciesNet returned no classes, got {sorted(result)}")
    return classes, scores


def run_classification(
    classifier: Any,
    image_path: str,
    detections: List[DetectionInfo],
    taxonomy_map: dict[str, str],
    ensemble: Any,
) -> List[Classification]:
    """
    Run SpeciesNet classification on animal detections.

    Only processes detections with category="animal". Each detection's
    top-5 goes through roll_up, then the taxonomy CSV walk-up.

    Args:
        classifier: Loaded SpeciesNetClassifier instance
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates
        taxonomy_map: The project's taxonomy CSV mapping, never empty (the
            worker refuses to classify for a project without one)
        ensemble: SpeciesNetEnsemble, the source of the taxonomy table

    Returns:
        List of Classification objects (top-1 predictions per animal)

    Raises:
        Exception: If inference fails
    """
    logger.info(
        "Running classification",
        image_path=image_path,
        num_detections=len(detections),
    )

    try:
        # Filter for animal detections only
        animal_detections = [d for d in detections if d.category == "animal"]

        if not animal_detections:
            logger.info(
                "No animal detections to classify",
                image_path=image_path,
                total_detections=len(detections)
            )
            return []

        logger.info(
            "Processing animal detections",
            image_path=image_path,
            num_animals=len(animal_detections),
            total_detections=len(detections)
        )

        # Open image once for all detections (SpeciesNet expects PIL Image)
        pil_image = Image.open(image_path)

        classifications = []

        for detection in animal_detections:
            # SpeciesNet BBox expects normalized [x_min, y_min, width, height]
            # which matches our detection bbox format directly
            bbox = BBox(
                xmin=detection.bbox_normalized[0],
                ymin=detection.bbox_normalized[1],
                width=detection.bbox_normalized[2],
                height=detection.bbox_normalized[3]
            )

            # preprocess() expects PIL Image, predict() expects file path string
            preprocessed = classifier.preprocess(pil_image, bboxes=[bbox])
            result = classifier.predict(image_path, preprocessed)

            classes, scores = read_top5(result)
            raw_score = scores[0]

            label_for_taxonomy, score_for_taxonomy = roll_up(classes, scores, ensemble)
            if label_for_taxonomy != classes[0]:
                logger.debug(
                    "Rollup applied",
                    detection_id=detection.detection_id,
                    raw_label=classes[0],
                    label=label_for_taxonomy,
                )

            species = apply_taxonomy_walkup(label_for_taxonomy, taxonomy_map)

            classification = Classification(
                detection_id=detection.detection_id,
                species=species,
                confidence=score_for_taxonomy,
                raw_prediction=label_for_taxonomy,
                raw_confidence=raw_score
            )

            classifications.append(classification)

            logger.info(
                "Classification complete",
                detection_id=detection.detection_id,
                species=classification.species,
                confidence=round(classification.confidence, 4),
                raw_prediction=classification.raw_prediction
            )

        logger.info(
            "All classifications complete",
            image_path=image_path,
            num_classifications=len(classifications)
        )

        return classifications

    except Exception as e:
        logger.error(
            "Classification failed",
            image_path=image_path,
            error=str(e),
            exc_info=True
        )
        raise


def patch_info_json(model_dir: Path) -> None:
    """Point info.json's detector at a local dummy file.

    SpeciesNet's ModelInfo downloads MegaDetector (about 150 MB) when the
    detector field is a URL. Only the classifier is used here.
    """
    info_path = model_dir / "info.json"
    with open(info_path) as f:
        info = json.load(f)
    detector = info.get("detector")
    if isinstance(detector, str) and detector.startswith("http"):
        dummy_path = model_dir / "dummy_detector.pt"
        dummy_path.touch()
        info["detector"] = str(dummy_path)
        with open(info_path, "w") as f:
            json.dump(info, f, indent=2)
        logger.info("Patched info.json to prevent MegaDetector download", original_detector=detector)


class SpeciesNetModel:
    def __init__(self, model: ClassificationModel, classifier: Any, ensemble: Any):
        self.model = model
        self.classifier = classifier
        self.ensemble = ensemble

    def classify(
        self, image_path: str, detections: List[DetectionInfo], project: ProjectConfig
    ) -> List[Classification]:
        """Top-1 per animal detection, through the project's label CSV. The
        mapping is read per image, so a CSV upload takes effect on the next
        image."""
        taxonomy_map = get_project_taxonomy_map(project.project_id)
        return run_classification(
            self.classifier, image_path, detections, taxonomy_map, self.ensemble
        )


def load(model: ClassificationModel, model_dir: Path, device: str) -> SpeciesNetModel:
    """The classifier on the device, and the ensemble for its taxonomy
    table (`combine()` is never called, and nothing is geofenced)."""
    patch_info_json(model_dir)
    classifier = SpeciesNetClassifier(model_name=str(model_dir), device=device)
    ensemble = SpeciesNetEnsemble(model_name=str(model_dir), geofence=False)
    check_vendored_taxonomy(model, ensemble.taxonomy_map)
    return SpeciesNetModel(model, classifier, ensemble)


def check_vendored_taxonomy(model: ClassificationModel, taxonomy_map: dict) -> None:
    """Refuse to run when the vendored taxonomy is not the model's own.

    The API checks uploaded CSVs against the vendored file, so a difference
    would accept names this model never predicts, or refuse ones it does.
    The ensemble's keys are "class;order;family;genus;species".
    """
    names = taxon_names(
        taxa for taxa in (key.split(";") for key in taxonomy_map) if len(taxa) == 5
    )
    expected = speciesnet_taxa()
    if names != expected:
        raise RuntimeError(
            f"{model.id}: the model's taxonomy differs from model_taxonomy/{model.id}.txt: "
            f"{sorted(names ^ expected)[:20]}"
        )
