"""Tests for the per-site performance accumulation (Quentin's point 10)."""
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


def _det(category="animal", confidence=0.9, species=None, cls_confidence=0.9):
    classifications = (
        [SimpleNamespace(species=species, confidence=cls_confidence)]
        if species
        else []
    )
    return SimpleNamespace(
        category=category, confidence=confidence, classifications=classifications
    )


def _image(deployment_id, observations=(), detections=()):
    return SimpleNamespace(
        deployment_id=deployment_id,
        human_observations=list(observations),
        detections=list(detections),
    )


SITES = {1: (10, "North ridge"), 2: (11, "South bridge")}


def _run(images, site_by_deployment=SITES):
    from routers.statistics import pair_verified_images

    return pair_verified_images(images, 0.5, None, site_by_deployment)


class TestSiteAccumulation:
    def test_images_group_on_their_deployments_site(self):
        _, _, _, site_acc = _run([
            _image(1, [_obs("fox")], [_det(species="fox")]),
            _image(1, [_obs("fox")], [_det(species="fox")]),
            _image(2, [_obs("deer")], [_det(species="deer")]),
        ])
        assert site_acc[(10, "North ridge")]["images"] == 2
        assert site_acc[(11, "South bridge")]["images"] == 1

    def test_accuracy_counts_agreements_per_site(self):
        # North ridge: fox agreed. South bridge: deer called a boar.
        _, _, _, site_acc = _run([
            _image(1, [_obs("fox")], [_det(species="fox")]),
            _image(2, [_obs("deer")], [_det(species="boar")]),
        ])
        north = site_acc[(10, "North ridge")]
        south = site_acc[(11, "South bridge")]
        assert (north["correct"], north["subjects"]) == (1, 1)
        assert (south["correct"], south["subjects"]) == (0, 1)

    def test_empty_counts_validator_said_nothing(self):
        # Two empties (one the AI agreed on, one false AI fox) and one real fox.
        _, _, _, site_acc = _run([
            _image(1, [], []),
            _image(1, [], [_det(species="fox")]),
            _image(1, [_obs("fox")], [_det(species="fox")]),
        ])
        acc = site_acc[(10, "North ridge")]
        assert acc["empty"] == 2
        assert acc["images"] == 3
        # The agreed empty is a correct subject, the invented fox is not.
        assert (acc["correct"], acc["subjects"]) == (2, 3)

    def test_unresolved_deployment_lands_on_the_none_key(self):
        _, _, _, site_acc = _run([
            _image(None, [_obs("fox")], []),
            _image(99, [_obs("fox")], []),  # deployment unknown to the map
        ])
        assert site_acc[(None, None)]["images"] == 2

    def test_overall_counters_are_unchanged_by_the_refactor(self):
        # The same numbers the endpoint reported before the by-site work.
        human, ai, matrix, _ = _run([
            _image(1, [_obs("fox", 2)], [_det(species="fox")]),
            _image(2, [], [_det(category="person", species=None)]),
        ])
        assert human == {"fox": 2}
        assert ai == {"fox": 1, "person": 1}
        assert matrix[("fox", "fox")] == 1
        assert matrix[("fox", "empty")] == 1
        assert matrix[("empty", "person")] == 1

    def test_thresholds_hide_weak_detections(self):
        _, ai, _, site_acc = _run([
            _image(1, [], [
                _det(species="fox", confidence=0.3),
                _det(species="fox", cls_confidence=0.1),
            ]),
        ], SITES)
        # The detection threshold (0.5) drops the first detection. With no
        # classification thresholds configured the second stays visible.
        assert ai == {"fox": 1}
        assert site_acc[(10, "North ridge")]["empty"] == 1
