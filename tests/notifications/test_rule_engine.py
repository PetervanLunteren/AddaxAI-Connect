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
