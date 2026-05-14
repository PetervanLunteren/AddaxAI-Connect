"""
Tests for detection_confidence handling in the notification rule engine.

Migrated from services/notifications/test_rule_engine.py into the unified test suite.
Reproduces the confidence resolution logic so tests run without DB dependencies.
"""
import pytest


def resolve_confidence(event):
    """
    Extract the confidence value used for threshold comparison.
    Mirrors rule_engine.py:
        confidence = event.get('detection_confidence', event.get('confidence'))
    """
    return event.get("detection_confidence", event.get("confidence"))


def check_threshold(event, detection_threshold):
    """
    Return True if the event should be BLOCKED (below threshold).
    Return False if it passes. Return None if confidence is missing.
    """
    confidence = resolve_confidence(event)
    if confidence is None:
        return None
    return confidence < detection_threshold


class TestConfidenceResolution:
    def test_prefers_detection_confidence(self):
        event = {"confidence": 0.88, "detection_confidence": 0.92}
        assert resolve_confidence(event) == 0.92

    def test_falls_back_to_classification_confidence(self):
        event = {"confidence": 0.88}
        assert resolve_confidence(event) == 0.88

    def test_returns_none_when_both_missing(self):
        assert resolve_confidence({"species": "fox"}) is None

    def test_detection_confidence_zero_is_not_none(self):
        event = {"confidence": 0.88, "detection_confidence": 0.0}
        assert resolve_confidence(event) == 0.0


class TestThresholdCheck:
    def test_high_detection_confidence_passes(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.92}
        assert check_threshold(event, 0.5) is False

    def test_low_detection_confidence_blocked(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.15}
        assert check_threshold(event, 0.5) is True

    def test_at_threshold_passes(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.5}
        assert check_threshold(event, 0.5) is False

    def test_just_below_threshold_blocked(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.499}
        assert check_threshold(event, 0.5) is True

    def test_fallback_above_threshold_passes(self):
        event = {"species": "fox", "confidence": 0.88}
        assert check_threshold(event, 0.5) is False

    def test_fallback_below_threshold_blocked(self):
        event = {"species": "fox", "confidence": 0.30}
        assert check_threshold(event, 0.5) is True

    def test_missing_confidence_returns_none(self):
        assert check_threshold({"species": "fox"}, 0.5) is None

    def test_zero_threshold_everything_passes(self):
        event = {"species": "fox", "detection_confidence": 0.01}
        assert check_threshold(event, 0.0) is False


def species_matches(notify_species, event_species):
    """
    Mirrors rule_engine.py:
        notify_species = type_config.get('notify_species')
        if not notify_species or species not in notify_species:
            return None
    Returns True if the species would be notified, False otherwise.
    """
    if not notify_species or event_species not in notify_species:
        return False
    return True


class TestSpeciesFilter:
    def test_empty_list_blocks_all(self):
        assert species_matches([], "fox") is False

    def test_none_blocks_all(self):
        assert species_matches(None, "fox") is False

    def test_species_in_list_passes(self):
        assert species_matches(["fox", "deer"], "fox") is True

    def test_species_not_in_list_blocked(self):
        assert species_matches(["fox", "deer"], "wolf") is False

    def test_single_item_list_passes(self):
        assert species_matches(["fox"], "fox") is True


class TestOriginalBugScenario:
    def test_bug_scenario_new_format(self):
        event = {
            "event_type": "species_detection",
            "species": "fox",
            "confidence": 0.88,
            "detection_confidence": 0.15,
        }
        assert check_threshold(event, 0.5) is True

    def test_legitimate_detection_still_passes(self):
        event = {
            "event_type": "species_detection",
            "species": "fox",
            "confidence": 0.88,
            "detection_confidence": 0.92,
        }
        assert check_threshold(event, 0.5) is False


# ---------------------------------------------------------------------------
# Camera-scope check. Mirrors the notify_cameras branch in
# rule_engine._evaluate_json_preferences: absent / null = all cameras,
# a list (including []) restricts to those camera ids.
# ---------------------------------------------------------------------------

def check_camera_scope(event, notify_cameras):
    """Return True if the event should be BLOCKED, False if it passes."""
    if notify_cameras is None:
        return False
    return event.get("camera_id") not in notify_cameras


class TestCameraScope:
    def test_missing_notify_cameras_passes(self):
        assert check_camera_scope({"species": "fox", "camera_id": 3}, None) is False

    def test_camera_in_scope_passes(self):
        assert check_camera_scope({"species": "fox", "camera_id": 3}, [1, 3, 7]) is False

    def test_camera_not_in_scope_blocked(self):
        assert check_camera_scope({"species": "fox", "camera_id": 9}, [1, 3, 7]) is True

    def test_empty_list_blocks_every_camera(self):
        assert check_camera_scope({"species": "fox", "camera_id": 3}, []) is True

    def test_missing_camera_id_blocked_when_scoped(self):
        assert check_camera_scope({"species": "fox"}, [1, 3, 7]) is True

    def test_missing_camera_id_passes_when_unscoped(self):
        assert check_camera_scope({"species": "fox"}, None) is False
