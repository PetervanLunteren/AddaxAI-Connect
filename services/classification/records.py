"""
The records the classification worker passes between its modules: what a
detection is, what a classification is, and what the worker needs to know
about the project an image belongs to.
"""
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class DetectionInfo:
    """One MegaDetector detection, with the image size for pixel maths."""
    detection_id: int
    category: str
    confidence: float
    bbox_normalized: List[float]  # [x_min, y_min, width, height], 0-1
    image_width: int
    image_height: int


@dataclass
class Classification:
    """One top-1 species label for a detection. The raw fields are filled
    by SpeciesNet only: its label before the project's CSV mapping, and the
    classifier's own score before the geofence and rollup."""
    detection_id: int
    species: str
    confidence: float
    raw_prediction: Optional[str] = None
    raw_confidence: Optional[float] = None


@dataclass
class ProjectConfig:
    """What classification needs from the image's project."""
    project_id: int
    classification_model: str
    # The species that occur in the project area, None for all. Fixed-class
    # models renormalise over this list; SpeciesNet ignores it.
    included_species: Optional[List[str]]
