"""Tests for strongest_hidden_detection (empty-image confidence display)."""
import sys
import os

# Add API service to path so we can import the module directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.detection_filtering import strongest_hidden_detection


class StubClassification:
    def __init__(self, species: str, confidence: float):
        self.species = species
        self.confidence = confidence


class StubDetection:
    def __init__(self, category: str, confidence: float, classifications=None):
        self.category = category
        self.confidence = confidence
        self.classifications = classifications or []


class TestStrongestHiddenDetection:
    def test_no_detections_returns_none(self):
        # A truly empty image: nothing was stored at inference time, so there
        # is no confidence value to show.
        assert strongest_hidden_detection([], 0.5) is None

    def test_animal_below_detection_threshold(self):
        detections = [
            StubDetection("animal", 0.34, [StubClassification("wild boar", 0.88)]),
        ]
        result = strongest_hidden_detection(detections, 0.5)
        assert result == {
            "category": "animal",
            "confidence": 0.34,
            "species": "wild boar",
            "species_confidence": 0.88,
            "hidden_by": "detection_threshold",
        }

    def test_person_below_detection_threshold_has_no_species(self):
        detections = [StubDetection("person", 0.42)]
        result = strongest_hidden_detection(detections, 0.5)
        assert result["category"] == "person"
        assert result["species"] is None
        assert result["species_confidence"] is None
        assert result["hidden_by"] == "detection_threshold"

    def test_animal_above_threshold_hidden_by_classification(self):
        # The detection passed the detection threshold, so the image can only
        # be empty because the species prediction stayed under the
        # classification threshold.
        detections = [
            StubDetection("animal", 0.62, [StubClassification("bird", 0.12)]),
        ]
        result = strongest_hidden_detection(detections, 0.5)
        assert result["confidence"] == 0.62
        assert result["species"] == "bird"
        assert result["hidden_by"] == "classification_threshold"

    def test_picks_highest_confidence_detection(self):
        detections = [
            StubDetection("person", 0.20),
            StubDetection("animal", 0.45, [StubClassification("fox", 0.70)]),
            StubDetection("vehicle", 0.15),
        ]
        result = strongest_hidden_detection(detections, 0.5)
        assert result["category"] == "animal"
        assert result["confidence"] == 0.45
        assert result["species"] == "fox"

    def test_confidence_exactly_at_threshold_is_classification_hidden(self):
        # Visibility elsewhere uses confidence >= threshold, so a detection
        # exactly at the threshold passed it and must not be reported as
        # hidden by the detection threshold.
        detections = [
            StubDetection("animal", 0.5, [StubClassification("bird", 0.05)]),
        ]
        result = strongest_hidden_detection(detections, 0.5)
        assert result["hidden_by"] == "classification_threshold"
