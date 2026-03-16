"""
Classification inference logic

Runs SpeciesNet inference on animal detections and processes results.
"""
from PIL import Image
from typing import Any, List, Optional

from shared.logger import get_logger
from shared.taxonomy import apply_taxonomy_walkup
from config import get_settings

logger = get_logger("classification-speciesnet.classifier")
settings = get_settings()


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


def parse_speciesnet_label(label: str) -> tuple[str, str]:
    """
    Parse SpeciesNet semicolon-delimited label into common name and full label.

    Label format: uuid;class;order;family;genus;species;common_name
    Special cases: blank, animal, human, vehicle

    Args:
        label: Raw SpeciesNet label string

    Returns:
        Tuple of (common_name, full_label)
    """
    parts = label.split(';')
    common_name = parts[-1] if parts else label
    return common_name, label


def _apply_ensemble(
    ensemble: Any,
    image_path: str,
    classifier_result: dict,
    detection: DetectionInfo
) -> Optional[tuple[str, float]]:
    """
    Apply SpeciesNet ensemble (geofencing + taxonomic rollup) to a single detection.

    Formats our data for ensemble.combine() and extracts the result.

    Args:
        ensemble: SpeciesNetEnsemble instance
        image_path: Path to the image file
        classifier_result: Raw classifier predict() output for this detection
        detection: DetectionInfo for this detection

    Returns:
        Tuple of (label, score) or None if ensemble fails
    """
    # Map our categories to SpeciesNet format
    category_map = {"animal": "1", "person": "2", "vehicle": "3"}
    label_map = {"animal": "animal", "person": "human", "vehicle": "vehicle"}

    sn_category = category_map.get(detection.category, "1")
    sn_label = label_map.get(detection.category, "animal")

    detector_results = {
        image_path: {
            "detections": [{
                "category": sn_category,
                "label": sn_label,
                "conf": detection.confidence,
                "bbox": detection.bbox_normalized
            }]
        }
    }

    classifier_results = {image_path: classifier_result}

    geolocation_results = {
        image_path: {
            "country": settings.speciesnet_country_code,
            "admin1_region": settings.speciesnet_admin1_region or ""
        }
    }

    results = ensemble.combine(
        filepaths=[image_path],
        classifier_results=classifier_results,
        detector_results=detector_results,
        geolocation_results=geolocation_results,
        partial_predictions={}
    )

    # combine() returns a list with one result per filepath
    if results:
        result = results[0]
        label = result.get("prediction", "")
        score = result.get("prediction_score", 0.0)
        if label:
            return label, score

    return None


def run_classification(
    classifier: Any,
    image_path: str,
    detections: List[DetectionInfo],
    included_species: Optional[List[str]] = None,
    taxonomy_map: Optional[dict[str, str]] = None,
    ensemble: Any = None
) -> List[Classification]:
    """
    Run SpeciesNet classification on animal detections.

    Only processes detections with category="animal".
    For each detection, creates a BBox and calls the SpeciesNet classifier.
    If an ensemble is provided, applies geofencing and taxonomic rollup
    before taxonomy CSV mapping.

    Args:
        classifier: Loaded SpeciesNetClassifier instance
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates
        included_species: Ignored for SpeciesNet (deferred to taxonomy mapping)
        taxonomy_map: Taxonomy CSV mapping dict
        ensemble: Optional SpeciesNetEnsemble for geofencing

    Returns:
        List of Classification objects (top-1 predictions per animal)

    Raises:
        Exception: If inference fails
    """
    logger.info(
        "Running classification",
        image_path=image_path,
        num_detections=len(detections),
        ensemble_enabled=ensemble is not None
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

        from speciesnet import BBox

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
                raw_label = classes[0]
                raw_score = scores[0]

                _, raw_full_label = parse_speciesnet_label(raw_label)

                # Apply ensemble (geofencing + rollup) if available
                label_for_taxonomy = raw_full_label
                score_for_taxonomy = raw_score

                if ensemble:
                    try:
                        ensemble_result = _apply_ensemble(
                            ensemble, image_path, result, detection
                        )
                        if ensemble_result:
                            ensemble_label, ensemble_score = ensemble_result
                            _, label_for_taxonomy = parse_speciesnet_label(ensemble_label)
                            score_for_taxonomy = ensemble_score
                            logger.debug(
                                "Ensemble applied",
                                detection_id=detection.detection_id,
                                raw_label=raw_full_label,
                                ensemble_label=label_for_taxonomy
                            )
                    except Exception as e:
                        logger.warning(
                            "Ensemble failed, using raw classifier output",
                            detection_id=detection.detection_id,
                            error=str(e)
                        )

                # Apply taxonomy walk-up on ensemble output (or raw if no ensemble)
                if taxonomy_map:
                    species = apply_taxonomy_walkup(label_for_taxonomy, taxonomy_map)
                else:
                    common_name, _ = parse_speciesnet_label(label_for_taxonomy)
                    species = common_name

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
                    species="unknown",
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
