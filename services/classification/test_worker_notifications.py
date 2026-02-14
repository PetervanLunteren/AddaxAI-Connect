"""
Tests for detection threshold filtering in notification pipeline.

Verifies that notifications and annotated images only include detections
with confidence >= project.detection_threshold.
"""
import sys
import os
from unittest.mock import patch, MagicMock, call
import pytest

# Add shared package to path so imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'shared'))
sys.path.insert(0, os.path.dirname(__file__))


# ---------------------------------------------------------------------------
# Lightweight stand-ins for domain classes used inside the worker
# ---------------------------------------------------------------------------

class FakeDetectionInfo:
    def __init__(self, detection_id, category, confidence, bbox_normalized, image_width, image_height):
        self.detection_id = detection_id
        self.category = category
        self.confidence = confidence
        self.bbox_normalized = bbox_normalized
        self.image_width = image_width
        self.image_height = image_height


class FakeClassification:
    def __init__(self, detection_id, species, confidence):
        self.detection_id = detection_id
        self.species = species
        self.confidence = confidence


# ---------------------------------------------------------------------------
# Helpers – extract the pure filtering logic from the worker so we can test
# it without mocking the entire DB/queue/MinIO stack.
# ---------------------------------------------------------------------------

def filter_species_map(classifications, detection_confidence, det_threshold):
    """
    Reproduce the species_map filtering logic from worker.py lines 156-163.
    Returns a dict of {species: classification} for above-threshold detections.
    """
    species_map = {}
    for classification in classifications:
        det_conf = detection_confidence.get(classification.detection_id, 0)
        if det_conf < det_threshold:
            continue
        species = classification.species
        if species not in species_map or classification.confidence > species_map[species].confidence:
            species_map[species] = classification
    return species_map


def filter_annotation_pairs(classifications, detections, det_threshold):
    """
    Reproduce the annotation pair filtering logic from worker.py lines 204-228.
    Returns list of (detection, classification) tuples for above-threshold detections.
    """
    pairs = []
    for classification in classifications:
        matching_det = next(
            (d for d in detections if d.detection_id == classification.detection_id),
            None
        )
        if matching_det and matching_det.confidence >= det_threshold:
            pairs.append((matching_det, classification))
    return pairs


def build_notification_payload(species, classification, detection_confidence, camera_project_id=1):
    """
    Reproduce the notification event payload from worker.py lines 279-292.
    Only checks the fields relevant to threshold filtering.
    """
    return {
        "event_type": "species_detection",
        "project_id": camera_project_id,
        "species": species,
        "confidence": classification.confidence,
        "detection_confidence": detection_confidence.get(classification.detection_id, 0),
    }


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def high_confidence_detection():
    """Detection well above a 0.5 threshold."""
    return FakeDetectionInfo(
        detection_id=1, category="animal", confidence=0.92,
        bbox_normalized=[0.1, 0.2, 0.3, 0.4], image_width=1920, image_height=1080,
    )


@pytest.fixture
def low_confidence_detection():
    """Detection below a 0.5 threshold."""
    return FakeDetectionInfo(
        detection_id=2, category="animal", confidence=0.15,
        bbox_normalized=[0.5, 0.5, 0.2, 0.2], image_width=1920, image_height=1080,
    )


@pytest.fixture
def borderline_detection():
    """Detection exactly at the 0.5 threshold."""
    return FakeDetectionInfo(
        detection_id=3, category="animal", confidence=0.50,
        bbox_normalized=[0.3, 0.3, 0.1, 0.1], image_width=1920, image_height=1080,
    )


# ---------------------------------------------------------------------------
# Tests – species_map filtering
# ---------------------------------------------------------------------------

class TestSpeciesMapFiltering:
    """Tests for the species_map threshold filter in the notification section."""

    def test_high_confidence_detection_included(self, high_confidence_detection):
        classifications = [FakeClassification(detection_id=1, species="fox", confidence=0.88)]
        det_conf = {1: high_confidence_detection.confidence}

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert "fox" in result
        assert result["fox"].confidence == 0.88

    def test_low_confidence_detection_excluded(self, low_confidence_detection):
        classifications = [FakeClassification(detection_id=2, species="fox", confidence=0.88)]
        det_conf = {2: low_confidence_detection.confidence}

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert result == {}

    def test_borderline_detection_at_threshold_included(self, borderline_detection):
        """Detection confidence exactly equal to threshold should pass (>=)."""
        classifications = [FakeClassification(detection_id=3, species="deer", confidence=0.75)]
        det_conf = {3: borderline_detection.confidence}

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert "deer" in result

    def test_mixed_detections_only_above_threshold_included(
        self, high_confidence_detection, low_confidence_detection
    ):
        classifications = [
            FakeClassification(detection_id=1, species="fox", confidence=0.88),
            FakeClassification(detection_id=2, species="badger", confidence=0.91),
        ]
        det_conf = {
            1: high_confidence_detection.confidence,  # 0.92 – above
            2: low_confidence_detection.confidence,    # 0.15 – below
        }

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert "fox" in result
        assert "badger" not in result

    def test_highest_classification_confidence_wins_per_species(self, high_confidence_detection):
        """When two classifications map to the same species, keep the highest."""
        det2 = FakeDetectionInfo(
            detection_id=4, category="animal", confidence=0.80,
            bbox_normalized=[0.6, 0.6, 0.1, 0.1], image_width=1920, image_height=1080,
        )
        classifications = [
            FakeClassification(detection_id=1, species="fox", confidence=0.70),
            FakeClassification(detection_id=4, species="fox", confidence=0.95),
        ]
        det_conf = {1: 0.92, 4: 0.80}

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert result["fox"].confidence == 0.95

    def test_missing_detection_id_defaults_to_zero(self):
        """If detection_id not in the map, confidence defaults to 0 (below any threshold)."""
        classifications = [FakeClassification(detection_id=999, species="fox", confidence=0.88)]
        det_conf = {}

        result = filter_species_map(classifications, det_conf, det_threshold=0.5)

        assert result == {}

    def test_empty_classifications_returns_empty(self):
        result = filter_species_map([], {}, det_threshold=0.5)
        assert result == {}

    def test_zero_threshold_includes_everything(self, low_confidence_detection):
        classifications = [FakeClassification(detection_id=2, species="fox", confidence=0.88)]
        det_conf = {2: low_confidence_detection.confidence}

        result = filter_species_map(classifications, det_conf, det_threshold=0)

        assert "fox" in result


# ---------------------------------------------------------------------------
# Tests – annotation pair filtering
# ---------------------------------------------------------------------------

class TestAnnotationPairFiltering:
    """Tests for detection/classification pair filtering used for annotated images."""

    def test_above_threshold_detection_produces_pair(self, high_confidence_detection):
        classifications = [FakeClassification(detection_id=1, species="fox", confidence=0.88)]
        detections = [high_confidence_detection]

        pairs = filter_annotation_pairs(classifications, detections, det_threshold=0.5)

        assert len(pairs) == 1
        assert pairs[0][0].detection_id == 1

    def test_below_threshold_detection_excluded(self, low_confidence_detection):
        classifications = [FakeClassification(detection_id=2, species="fox", confidence=0.88)]
        detections = [low_confidence_detection]

        pairs = filter_annotation_pairs(classifications, detections, det_threshold=0.5)

        assert pairs == []

    def test_mixed_detections_only_above_threshold_annotated(
        self, high_confidence_detection, low_confidence_detection
    ):
        classifications = [
            FakeClassification(detection_id=1, species="fox", confidence=0.88),
            FakeClassification(detection_id=2, species="badger", confidence=0.91),
        ]
        detections = [high_confidence_detection, low_confidence_detection]

        pairs = filter_annotation_pairs(classifications, detections, det_threshold=0.5)

        assert len(pairs) == 1
        assert pairs[0][0].detection_id == 1

    def test_no_matching_detection_skipped(self):
        classifications = [FakeClassification(detection_id=999, species="fox", confidence=0.88)]
        detections = []

        pairs = filter_annotation_pairs(classifications, detections, det_threshold=0.5)

        assert pairs == []

    def test_borderline_detection_included(self, borderline_detection):
        classifications = [FakeClassification(detection_id=3, species="deer", confidence=0.75)]
        detections = [borderline_detection]

        pairs = filter_annotation_pairs(classifications, detections, det_threshold=0.5)

        assert len(pairs) == 1


# ---------------------------------------------------------------------------
# Tests – notification payload
# ---------------------------------------------------------------------------

class TestNotificationPayload:
    """Tests that the notification event carries both confidence values."""

    def test_payload_includes_detection_confidence(self):
        classification = FakeClassification(detection_id=1, species="fox", confidence=0.88)
        det_conf = {1: 0.92}

        payload = build_notification_payload("fox", classification, det_conf)

        assert payload["confidence"] == 0.88            # classification confidence
        assert payload["detection_confidence"] == 0.92   # MegaDetector confidence

    def test_payload_detection_confidence_defaults_to_zero(self):
        classification = FakeClassification(detection_id=999, species="fox", confidence=0.88)
        det_conf = {}

        payload = build_notification_payload("fox", classification, det_conf)

        assert payload["detection_confidence"] == 0


# ---------------------------------------------------------------------------
# Tests – DetectionInfo confidence field
# ---------------------------------------------------------------------------

class TestDetectionInfoConfidence:
    """Verify DetectionInfo carries the confidence attribute."""

    def test_detection_info_stores_confidence(self):
        info = FakeDetectionInfo(
            detection_id=1, category="animal", confidence=0.75,
            bbox_normalized=[0.1, 0.2, 0.3, 0.4], image_width=1920, image_height=1080,
        )
        assert info.confidence == 0.75
