"""
Classification inference logic

Runs DeepFaune v1.4 inference on animal detections and processes results.
"""
import torch
import torch.nn.functional as F
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
        confidence: float
    ):
        self.detection_id = detection_id
        self.species = species
        self.confidence = confidence


# DeepFaune preprocessing transform (182x182, ImageNet normalization)
TRANSFORM = transforms.Compose([
    transforms.Resize((settings.crop_resolution, settings.crop_resolution), interpolation=transforms.InterpolationMode.BICUBIC),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
])


def get_crop(image: Image.Image, bbox_normalized: list[float]) -> Image.Image:
    """
    Extract and square crop from image using normalized bbox coordinates.

    Args:
        image: PIL Image
        bbox_normalized: [x_min, y_min, width, height] in 0-1 normalized format

    Returns:
        PIL Image: Squared crop
    """
    width, height = image.size
    x_min_norm, y_min_norm, width_norm, height_norm = bbox_normalized

    # Convert to pixel coordinates
    x_min = int(x_min_norm * width)
    y_min = int(y_min_norm * height)
    bbox_width = int(width_norm * width)
    bbox_height = int(height_norm * height)

    # Square the bbox by padding the shorter dimension symmetrically
    if bbox_width > bbox_height:
        # Wider than tall - pad vertically
        padding = (bbox_width - bbox_height) // 2
        y_min -= padding
        bbox_height = bbox_width
    else:
        # Taller than wide - pad horizontally
        padding = (bbox_height - bbox_width) // 2
        x_min -= padding
        bbox_width = bbox_height

    # Clip to image boundaries
    x_min = max(0, x_min)
    y_min = max(0, y_min)
    x_max = min(width, x_min + bbox_width)
    y_max = min(height, y_min + bbox_height)

    # Extract crop
    crop = image.crop((x_min, y_min, x_max, y_max))

    return crop


def run_classification(
    model: Any,
    image_path: str,
    detections: List[DetectionInfo]
) -> List[Classification]:
    """
    Run DeepFaune v1.4 classification on animal detections.

    Only processes detections with category="animal".
    Extracts square crops, preprocesses to 182x182, and runs inference.

    Args:
        model: Loaded DeepFaune model
        image_path: Path to full image file
        detections: List of DetectionInfo objects with bbox coordinates

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
                confidence, predicted_class = torch.max(probabilities, dim=1)

            # Get species name
            species_idx = predicted_class.item()
            species_name = DEEPFAUNE_CLASSES[species_idx]
            confidence_score = confidence.item()

            # Create classification result (top-1 only)
            classification = Classification(
                detection_id=detection.detection_id,
                species=species_name,
                confidence=confidence_score
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
