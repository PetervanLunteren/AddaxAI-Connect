"""
Classification inference logic

Runs SpeciesNet inference on animal detections and processes results.

Per detection this follows the reference pipeline for detection-level
SpeciesNet, `_process_classification_batch` in MegaDetector's
`megadetector/detection/run_md_and_speciesnet.py`: geofence first, then
taxonomic rollup when the geofence did not already roll up. Both steps are
the public functions of the speciesnet package. The ensemble's `combine()`
is deliberately not used: it picks one label for a whole image and mixes in
detector-confidence rules for people, vehicles and blanks, which do not
belong on a single detection.
"""
from PIL import Image
from typing import Any, List, Optional

from speciesnet import BBox
from speciesnet.geofence_utils import (
    geofence_animal_classification,
    roll_up_labels_to_first_matching_level,
)

from shared.logger import get_logger
from shared.taxonomy import UNKNOWN_ANIMAL, apply_taxonomy_walkup
from config import get_settings

logger = get_logger("classification-speciesnet.classifier")
settings = get_settings()

# Same values as run_md_and_speciesnet (DEFAULT_ROLLUP_TARGET_CONFIDENCE and
# the levels it passes), so a detection gets the label the reference
# pipeline would give it.
ROLLUP_TARGET_CONFIDENCE = 0.65
ROLLUP_LEVELS = ["species", "genus", "family", "order", "class", "kingdom"]


class DetectionInfo:
    """Detection information for classification"""
    def __init__(
        self,
        detection_id: int,
        category: str,
        confidence: float,
        bbox_normalized: list[float],
        image_width: int,
        image_height: int
    ):
        self.detection_id = detection_id
        self.category = category
        self.confidence = confidence
        self.bbox_normalized = bbox_normalized
        self.image_width = image_width
        self.image_height = image_height


class Classification:
    """Classification result"""
    def __init__(
        self,
        detection_id: int,
        species: str,
        confidence: float,
        raw_prediction: str | None = None,
        raw_confidence: float | None = None
    ):
        self.detection_id = detection_id
        self.species = species
        self.confidence = confidence
        self.raw_prediction = raw_prediction
        self.raw_confidence = raw_confidence


def speciesnet_admin1(region: Optional[str]) -> Optional[str]:
    """The admin1 region in the form SpeciesNet's geofence expects.

    Server settings store the full ISO 3166-2 code ("US-CA"), but the
    geofence keys hold only the part after the country ("CA"). Passing the
    full code makes every state-limited species count as out of range,
    everywhere in the country.
    """
    if not region:
        return None
    return region.split("-", 1)[-1]


def geofence_and_roll_up(
    classes: List[str],
    scores: List[float],
    ensemble: Any,
    country: Optional[str],
    admin1_region: Optional[str],
) -> tuple[str, float]:
    """Label and score for one detection from the classifier's top-5.

    Mirrors run_md_and_speciesnet: with a country, geofence first, which
    rolls an out-of-range top-1 up to an allowed ancestor. Otherwise apply
    the confidence roll-up. A roll-up that finds no level above the
    threshold keeps the top-1.
    """
    if country:
        label, score, source = geofence_animal_classification(
            labels=classes,
            scores=scores,
            country=country,
            admin1_region=admin1_region,
            taxonomy_map=ensemble.taxonomy_map,
            geofence_map=ensemble.geofence_map,
            enable_geofence=True,
        )
        if source != "classifier":
            return label, score

    rollup = roll_up_labels_to_first_matching_level(
        labels=classes,
        scores=scores,
        country=country,
        admin1_region=admin1_region,
        target_taxonomy_levels=ROLLUP_LEVELS,
        non_blank_threshold=ROLLUP_TARGET_CONFIDENCE,
        taxonomy_map=ensemble.taxonomy_map,
        geofence_map=ensemble.geofence_map,
        enable_geofence=country is not None,
    )
    if rollup is not None:
        label, score, _ = rollup
        return label, score

    return classes[0], scores[0]


def run_classification(
    classifier: Any,
    image_path: str,
    detections: List[DetectionInfo],
    taxonomy_map: dict[str, str],
    ensemble: Any,
    geofencing_config: Optional[dict[str, str]] = None
) -> List[Classification]:
    """
    Run SpeciesNet classification on animal detections.

    Only processes detections with category="animal". Each detection's
    top-5 goes through geofence_and_roll_up, then the taxonomy CSV walk-up.

    Args:
        classifier: Loaded SpeciesNetClassifier instance
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates
        taxonomy_map: The project's taxonomy CSV mapping, never empty (the
            worker refuses to classify for a project without one)
        ensemble: SpeciesNetEnsemble, the source of the taxonomy and geofence tables
        geofencing_config: Dict with 'country_code' and 'admin1_region', or None

    Returns:
        List of Classification objects (top-1 predictions per animal)

    Raises:
        Exception: If inference fails
    """
    country = geofencing_config.get("country_code") if geofencing_config else None
    admin1_region = speciesnet_admin1(
        geofencing_config.get("admin1_region") if geofencing_config else None
    )

    logger.info(
        "Running classification",
        image_path=image_path,
        num_detections=len(detections),
        country=country,
        admin1_region=admin1_region,
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

            # Extract top-1 prediction from raw classifier
            classifications_data = result.get("classifications", {}) if result else {}
            classes = classifications_data.get("classes", [])
            scores = classifications_data.get("scores", [])

            if classes and scores:
                raw_score = scores[0]

                label_for_taxonomy, score_for_taxonomy = geofence_and_roll_up(
                    classes, scores, ensemble, country, admin1_region
                )
                if label_for_taxonomy != classes[0]:
                    logger.debug(
                        "Geofence or rollup applied",
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
            else:
                classification = Classification(
                    detection_id=detection.detection_id,
                    species=UNKNOWN_ANIMAL,
                    confidence=0.0,
                    raw_prediction=None,
                    raw_confidence=None
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
