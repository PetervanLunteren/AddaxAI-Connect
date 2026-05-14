"""
Tests for detection_confidence handling in the notification rule engine.

Verifies that the rule engine checks detection_confidence (MegaDetector score)
against the project threshold, not the classification confidence.

These tests reproduce the confidence resolution logic from rule_engine.py
so they can run without sqlalchemy/database dependencies.
"""
import pytest


# ---------------------------------------------------------------------------
# Reproduce the confidence-check logic from rule_engine._evaluate_json_preferences
# (lines 175-189).  This is the exact code path we changed.
# ---------------------------------------------------------------------------

def resolve_confidence(event):
    """
    Extract the confidence value used for threshold comparison.

    Mirrors rule_engine.py:
        confidence = event.get('detection_confidence', event.get('confidence'))
    """
    return event.get('detection_confidence', event.get('confidence'))


def check_threshold(event, detection_threshold):
    """
    Return True if the event should be BLOCKED (below threshold).
    Return False if it passes.
    Return None if confidence is missing.

    Mirrors rule_engine.py:
        if confidence is None: return None  (warning)
        if confidence < project.detection_threshold: return None  (blocked)
    """
    confidence = resolve_confidence(event)
    if confidence is None:
        return None  # missing
    return confidence < detection_threshold


# ---------------------------------------------------------------------------
# Tests – confidence resolution
# ---------------------------------------------------------------------------

class TestConfidenceResolution:
    """Verify which confidence value is picked from the event."""

    def test_prefers_detection_confidence(self):
        event = {"confidence": 0.88, "detection_confidence": 0.92}
        assert resolve_confidence(event) == 0.92

    def test_falls_back_to_classification_confidence(self):
        event = {"confidence": 0.88}
        assert resolve_confidence(event) == 0.88

    def test_returns_none_when_both_missing(self):
        event = {"species": "fox"}
        assert resolve_confidence(event) is None

    def test_detection_confidence_zero_is_not_none(self):
        """A detection_confidence of 0.0 should be used, not fall back."""
        event = {"confidence": 0.88, "detection_confidence": 0.0}
        assert resolve_confidence(event) == 0.0


# ---------------------------------------------------------------------------
# Tests – threshold check
# ---------------------------------------------------------------------------

class TestThresholdCheck:
    """Verify threshold comparison uses the correct confidence value."""

    def test_high_detection_confidence_passes(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.92}
        assert check_threshold(event, 0.5) is False  # not blocked

    def test_low_detection_confidence_blocked(self):
        """The original bug: high classification conf, low MegaDetector conf."""
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.15}
        assert check_threshold(event, 0.5) is True  # blocked

    def test_at_threshold_passes(self):
        """Exactly at threshold (0.5 < 0.5 is False) -> passes."""
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.5}
        assert check_threshold(event, 0.5) is False

    def test_just_below_threshold_blocked(self):
        event = {"species": "fox", "confidence": 0.88, "detection_confidence": 0.499}
        assert check_threshold(event, 0.5) is True

    def test_fallback_above_threshold_passes(self):
        """Old event format without detection_confidence, classification conf is high."""
        event = {"species": "fox", "confidence": 0.88}
        assert check_threshold(event, 0.5) is False

    def test_fallback_below_threshold_blocked(self):
        """Old event format, classification conf is low."""
        event = {"species": "fox", "confidence": 0.30}
        assert check_threshold(event, 0.5) is True

    def test_missing_confidence_returns_none(self):
        event = {"species": "fox"}
        assert check_threshold(event, 0.5) is None

    def test_zero_threshold_everything_passes(self):
        event = {"species": "fox", "detection_confidence": 0.01}
        assert check_threshold(event, 0.0) is False


# ---------------------------------------------------------------------------
# Tests – the original bug scenario end-to-end
# ---------------------------------------------------------------------------

class TestOriginalBugScenario:
    """
    Regression tests for the reported issue: user receives a Telegram notification
    about a fox with no visible bounding box because the MegaDetector detection
    confidence was only 15%, but classification confidence was 88%.
    """

    def test_bug_scenario_new_format(self):
        """With detection_confidence in the event, the low-confidence detection is blocked."""
        event = {
            "event_type": "species_detection",
            "species": "fox",
            "confidence": 0.88,
            "detection_confidence": 0.15,
        }
        assert check_threshold(event, 0.5) is True, (
            "A 15% MegaDetector detection should be blocked at 50% threshold"
        )

    def test_legitimate_detection_still_passes(self):
        """A real high-confidence detection should still trigger notifications."""
        event = {
            "event_type": "species_detection",
            "species": "fox",
            "confidence": 0.88,
            "detection_confidence": 0.92,
        }
        assert check_threshold(event, 0.5) is False


# ---------------------------------------------------------------------------
# Reproduce the camera-scope logic from rule_engine._evaluate_json_preferences.
# notify_cameras absent or null = all cameras. A list (including []) restricts
# to those camera ids.
# ---------------------------------------------------------------------------

def check_camera_scope(event, notify_cameras):
    """
    Return True if the event should be BLOCKED (camera not in scope).
    Return False if it passes.

    Mirrors rule_engine.py:
        notify_cameras = type_config.get('notify_cameras')
        if notify_cameras is not None:
            if event.get('camera_id') not in notify_cameras:
                return None
    """
    if notify_cameras is None:
        return False
    return event.get('camera_id') not in notify_cameras


class TestCameraScope:
    """Verify per-camera filtering of species_detection events."""

    def test_missing_notify_cameras_passes(self):
        """Absent key = all cameras (legacy preferences)."""
        event = {"species": "fox", "camera_id": 3}
        assert check_camera_scope(event, None) is False

    def test_camera_in_scope_passes(self):
        event = {"species": "fox", "camera_id": 3}
        assert check_camera_scope(event, [1, 3, 7]) is False

    def test_camera_not_in_scope_blocked(self):
        event = {"species": "fox", "camera_id": 9}
        assert check_camera_scope(event, [1, 3, 7]) is True

    def test_empty_list_blocks_every_camera(self):
        """[] is an explicit 'no cameras', distinct from null."""
        event = {"species": "fox", "camera_id": 3}
        assert check_camera_scope(event, []) is True

    def test_missing_camera_id_blocked_when_scoped(self):
        """An event without camera_id cannot satisfy a scoped preference."""
        event = {"species": "fox"}
        assert check_camera_scope(event, [1, 3, 7]) is True

    def test_missing_camera_id_passes_when_unscoped(self):
        event = {"species": "fox"}
        assert check_camera_scope(event, None) is False
