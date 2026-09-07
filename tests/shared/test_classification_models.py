"""Tests for the shared classification model name map."""
from shared.classification_models import CLASSIFICATION_MODELS, model_info


class TestModelInfo:
    def test_known_key(self):
        assert model_info("speciesnet") is CLASSIFICATION_MODELS["speciesnet"]
        assert model_info("speciesnet")["name"] == "SpeciesNet v4.0.1"

    def test_unset_falls_back_to_deepfaune(self):
        assert model_info(None)["name"] == "DeepFaune v1.4"

    def test_unknown_falls_back_to_deepfaune(self):
        assert model_info("something-else")["name"] == "DeepFaune v1.4"
