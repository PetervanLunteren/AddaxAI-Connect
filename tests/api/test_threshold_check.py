"""Tests for the threshold check on the settings page (Quentin's point 13)."""
import os
import sys
from types import SimpleNamespace

# Add API service to path so we can import the modules directly
_api = os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
_api = os.path.abspath(_api)
if _api not in sys.path:
    sys.path.insert(0, _api)


def _obs(species, count=1):
    return SimpleNamespace(species=species, count=count)


def _det(species, confidence=0.9, cls_confidence=0.9):
    return SimpleNamespace(
        category="animal",
        confidence=confidence,
        classifications=[SimpleNamespace(species=species, confidence=cls_confidence)],
    )


def _image(observations=(), detections=()):
    return SimpleNamespace(
        deployment_id=None,
        human_observations=list(observations),
        detections=list(detections),
    )


def _check(images, mode, species=None, detection_threshold=0.0, thresholds=None, current=0.0):
    from routers.statistics import threshold_check

    support, steps, suggested = threshold_check(
        images, detection_threshold, thresholds, mode, current, species,
    )
    return support, {s["threshold"]: s for s in steps}, suggested


def _fox_set(copies=1):
    """Ten real foxes found with high confidence, ten deer the AI called fox
    with low confidence. Raising the fox threshold past 0.5 drops only the
    wrong ones."""
    images = []
    for _ in range(copies):
        images += [_image([_obs("fox")], [_det("fox", cls_confidence=0.8)]) for _ in range(10)]
        images += [_image([_obs("deer")], [_det("fox", cls_confidence=0.3)]) for _ in range(10)]
    return images


class TestSpeciesMode:
    def test_scores_follow_the_species_threshold(self):
        _, steps, _ = _check(_fox_set(), "species", "fox")
        assert steps[0.0]["precision"] == 0.5
        assert steps[0.0]["recall"] == 1.0
        assert steps[0.5]["precision"] == 1.0
        assert steps[0.5]["recall"] == 1.0
        # Above the true foxes' confidence nothing is called fox.
        assert steps[0.85]["precision"] is None
        assert steps[0.85]["recall"] == 0.0
        assert steps[0.85]["f1"] is None

    def test_suggests_the_best_step_closest_to_the_current_value(self):
        # F1 is 1.0 from 0.35 to 0.8; from 0.1 the nearest of those is 0.35.
        support, _, suggested = _check(_fox_set(copies=2), "species", "fox", current=0.1)
        assert support == 20
        assert suggested == 0.35

    def test_keeps_the_current_value_when_it_is_already_best(self):
        # On a flat F1 curve the check must not push the slider to 0%.
        _, _, suggested = _check(_fox_set(copies=2), "species", "fox", current=0.72)
        assert suggested == 0.72

    def test_a_gain_inside_the_tolerance_is_not_worth_a_move(self):
        # 200 foxes, one deer called fox at 0.3: F1 at 0.1 is 0.9975, at
        # 0.35 it is 1.0. Within the tolerance, so keep 0.1.
        images = [_image([_obs("fox")], [_det("fox", cls_confidence=0.8)]) for _ in range(200)]
        images.append(_image([_obs("deer")], [_det("fox", cls_confidence=0.3)]))
        _, _, suggested = _check(images, "species", "fox", current=0.1)
        assert suggested == 0.1

    def test_no_suggestion_below_the_minimum_support(self):
        support, _, suggested = _check(_fox_set(), "species", "fox")
        assert support == 10
        assert suggested is None

    def test_other_overrides_and_the_detection_threshold_still_apply(self):
        # The deer override hides the deer call at every fox step, and the
        # detection threshold hides the low-confidence fox box.
        images = [
            _image([_obs("fox")], [_det("deer", cls_confidence=0.4)]),
            _image([_obs("fox")], [_det("fox", confidence=0.1)]),
        ]
        thresholds = {"default": 0.0, "overrides": {"deer": 0.9}}
        _, steps, _ = _check(images, "species", "fox", detection_threshold=0.5, thresholds=thresholds)
        assert steps[0.0]["recall"] == 0.0


class TestDetectionMode:
    def test_scores_presence_whatever_the_species(self):
        images = (
            # Animal there, AI says a different species: still found.
            [_image([_obs("fox")], [_det("deer", confidence=0.8)]) for _ in range(10)]
            # Nothing there, AI sees something with low confidence.
            + [_image([], [_det("fox", confidence=0.2)]) for _ in range(10)]
            # Nothing there and the AI agrees.
            + [_image() for _ in range(5)]
        )
        support, steps, suggested = _check(images, "detection")
        assert support == 10
        assert steps[0.0]["precision"] == 0.5
        assert steps[0.0]["recall"] == 1.0
        assert steps[0.25]["precision"] == 1.0
        assert steps[0.25]["recall"] == 1.0
        assert suggested is None  # 10 is below the minimum support

    def test_suggestion_with_enough_examples(self):
        images = (
            [_image([_obs("fox")], [_det("fox", confidence=0.8)]) for _ in range(20)]
            + [_image([], [_det("fox", confidence=0.2)]) for _ in range(20)]
        )
        _, _, suggested = _check(images, "detection", current=0.1)
        assert suggested == 0.25


class TestDefaultMode:
    def test_scores_every_species_without_an_override_together(self):
        # Fox and deer both use the default and score as one group; badger
        # has its own override, so its wrong call does not count here.
        images = (
            [_image([_obs("fox")], [_det("fox", cls_confidence=0.8)]) for _ in range(10)]
            + [_image([_obs("deer")], [_det("deer", cls_confidence=0.8)]) for _ in range(10)]
            + [_image([_obs("deer")], [_det("fox", cls_confidence=0.3)]) for _ in range(5)]
            + [_image([_obs("badger")], [_det("fox", cls_confidence=0.9)]) for _ in range(5)]
            + [_image([_obs("badger")], [_det("badger", cls_confidence=0.9)]) for _ in range(5)]
        )
        thresholds = {"default": 0.0, "overrides": {"badger": 0.5}}
        support, steps, suggested = _check(images, "default", thresholds=thresholds, current=0.1)
        assert support == 25  # 10 fox + 15 deer, no badger
        # At 0.0: 20 right; predicted fox or deer 30 (incl. the 5 badger
        # called fox, which a default-mode user would see as a wrong fox).
        assert steps[0.0]["precision"] == 20 / 30
        # From 0.35 the low-confidence fox calls on deer are gone.
        assert steps[0.35]["precision"] == 20 / 25
        assert steps[0.35]["recall"] == 20 / 25
        assert suggested == 0.35

    def test_species_mode_needs_a_species(self):
        import pytest

        with pytest.raises(ValueError):
            _check(_fox_set(), "species")
        with pytest.raises(ValueError):
            _check(_fox_set(), "default", "fox")
