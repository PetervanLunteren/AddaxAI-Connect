"""
Classification inference logic

Runs DeepFaune v1.4 inference on animal detections and processes results.
"""
import torch
import torch.nn.functional as F
import numpy as np
from PIL import Image
from torchvision import transforms
from typing import Any, List, Optional

from shared.logger import get_logger
from config import get_settings
from model_loader import DEEPFAUNE_CLASSES

logger = get_logger("classification.classifier")
settings = get_settings()


class DetectionInfo:
    """Detection information for classification"""
    def __init__(
        self,
        detection_id: int,
        category: str,
        bbox_normalized: list[float],
        image_width: int,
        image_height: int
    ):
        self.detection_id = detection_id
        self.category = category
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
        raw_predictions: dict[str, float] = None,
        model_version: str = None
    ):
        self.detection_id = detection_id
        self.species = species
        self.confidence = confidence
        self.raw_predictions = raw_predictions or {}  # All predictions >0.05
        self.model_version = model_version


# DeepFaune preprocessing transform (182x182, custom normalization)
TRANSFORM = transforms.Compose([
    transforms.Resize((settings.crop_resolution, settings.crop_resolution), interpolation=transforms.InterpolationMode.BICUBIC),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.4850, 0.4560, 0.4060], std=[0.2290, 0.2240, 0.2250])
])


def get_crop(image: Image.Image, bbox_normalized: list[float]) -> Image.Image:
    """
    Extract and square crop from image using normalized bbox coordinates.
    Matches the reference DeepFaune implementation exactly.

    Args:
        image: PIL Image
        bbox_normalized: [x_min, y_min, width, height] in 0-1 normalized format

    Returns:
        PIL Image: Squared crop
    """
    width, height = image.size

    # Convert normalized coordinates to pixels (with rounding)
    xmin = int(round(bbox_normalized[0] * width))
    ymin = int(round(bbox_normalized[1] * height))
    xmax = int(round(bbox_normalized[2] * width)) + xmin
    ymax = int(round(bbox_normalized[3] * height)) + ymin

    # Calculate sizes
    xsize = xmax - xmin
    ysize = ymax - ymin

    # Square the bbox by padding the shorter dimension
    if xsize > ysize:
        ymin = ymin - int((xsize - ysize) / 2)
        ymax = ymax + int((xsize - ysize) / 2)
    if ysize > xsize:
        xmin = xmin - int((ysize - xsize) / 2)
        xmax = xmax + int((ysize - xsize) / 2)

    # Clip to image boundaries and extract crop
    image_cropped = image.crop((max(0, xmin), max(0, ymin),
                                min(xmax, image.width),
                                min(ymax, image.height)))

    return image_cropped


def run_classification(
    model: Any,
    image_path: str,
    detections: List[DetectionInfo],
    included_species: Optional[List[str]] = None
) -> List[Classification]:
    """
    Run DeepFaune v1.4 classification on animal detections.

    Only processes detections with category="animal".
    Extracts square crops, preprocesses to 182x182, and runs inference.
    Filters to only included species before selecting top-1 prediction.

    Args:
        model: Loaded DeepFaune model
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates
        included_species: List of species names to include in predictions (None = all species)

    Returns:
        List of Classification objects (top-1 predictions per animal)

    Raises:
        Exception: If inference fails
    """
    # None = all species allowed, List = only these species allowed

    logger.info(
        "Running classification",
        image_path=image_path,
        num_detections=len(detections),
        included_species_count=len(included_species) if included_species else 0,
        filter_mode="included" if included_species else "all"
    )

    try:
        # Load image
        image = Image.open(image_path).convert('RGB')
        image_width, image_height = image.size

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

        # Process each animal detection
        classifications = []
        device = next(model.parameters()).device

        for detection in animal_detections:
            # Extract and preprocess crop
            crop = get_crop(image, detection.bbox_normalized)
            crop_tensor = TRANSFORM(crop).unsqueeze(0)  # Add batch dimension
            crop_tensor = crop_tensor.to(device)

            # Run inference
            with torch.no_grad():
                logits = model(crop_tensor)
                probabilities = F.softmax(logits, dim=1)

            # Convert to numpy for easier processing
            probs_array = probabilities[0].cpu().numpy()

            # Filter to only included species and re-normalize
            # Step 1: Calculate sum of probabilities for included species
            remaining_prob_sum = 0.0
            for idx, prob in enumerate(probs_array):
                species = DEEPFAUNE_CLASSES[idx]
                # If included_species is None, include all species
                # If included_species is a list, only include species in the list
                if included_species is None or species in included_species:
                    remaining_prob_sum += prob

            # Step 2: Re-normalize probabilities and find top-1
            species_name = None
            confidence_score = 0.0

            for idx, prob in enumerate(probs_array):
                species = DEEPFAUNE_CLASSES[idx]
                # If included_species is None, include all species
                # If included_species is a list, only include species in the list
                if included_species is None or species in included_species:
                    # Re-normalize: divide by sum of remaining probabilities
                    normalized_prob = float(prob / remaining_prob_sum) if remaining_prob_sum > 0 else 0.0
                    if normalized_prob > confidence_score:
                        species_name = species
                        confidence_score = normalized_prob

            # Fallback if all species are excluded (shouldn't happen in practice)
            if species_name is None:
                logger.warning(
                    "All species excluded, falling back to highest probability",
                    detection_id=detection.detection_id
                )
                species_idx = np.argmax(probs_array)
                species_name = DEEPFAUNE_CLASSES[species_idx]
                confidence_score = float(probs_array[species_idx])

            # Create classification result (without raw predictions)
            classification = Classification(
                detection_id=detection.detection_id,
                species=species_name,
                confidence=confidence_score,
                raw_predictions=None,  # No longer storing raw predictions
                model_version=None  # No longer tracking model version
            )

            classifications.append(classification)

            logger.info(
                "Classification complete",
                detection_id=detection.detection_id,
                species=species_name,
                confidence=round(confidence_score, 4)
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
