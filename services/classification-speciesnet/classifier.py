"""
Classification inference logic

Runs SpeciesNet inference on animal detections and processes results.
"""
from PIL import Image
from typing import Any, List, Optional

from shared.logger import get_logger
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


def run_classification(
    classifier: Any,
    image_path: str,
    detections: List[DetectionInfo],
    included_species: Optional[List[str]] = None
) -> List[Classification]:
    """
    Run SpeciesNet classification on animal detections.

    Only processes detections with category="animal".
    For each detection, creates a BBox and calls the SpeciesNet classifier.

    Args:
        classifier: Loaded SpeciesNetClassifier instance
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates
        included_species: Ignored for SpeciesNet (deferred to taxonomy mapping)

    Returns:
        List of Classification objects (top-1 predictions per animal)

    Raises:
        Exception: If inference fails
    """
    logger.info(
        "Running classification",
        image_path=image_path,
        num_detections=len(detections)
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

            # Preprocess and predict
            preprocessed = classifier.preprocess(pil_image, bboxes=[bbox])
            result = classifier.predict(pil_image, preprocessed)

            # Extract top-1 prediction
            if result and len(result) > 0:
                top_prediction = result[0]
                label = top_prediction.get("label", "unknown")
                score = top_prediction.get("score", 0.0)

                common_name, full_label = parse_speciesnet_label(label)

                classification = Classification(
                    detection_id=detection.detection_id,
                    species=common_name,
                    confidence=score,
                    raw_prediction=full_label,
                    raw_confidence=score
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
