"""Fixed-class models through the desktop inference.py contract, with a
fake inference.py written to disk. No torch."""
from pathlib import Path

import pytest
from PIL import Image

import fixed_model
from fixed_model import FixedModel, load, load_inference, pick_species
from records import DetectionInfo, ProjectConfig
from shared.classification_models import DEEPFAUNE_ID, get_model

FAKE_INFERENCE = '''
class ModelInference:
    def __init__(self, model_dir, model_path):
        self.model_dir = model_dir
        self.model_path = model_path
        self.calls = []
    def check_gpu(self):
        self.calls.append("check_gpu")
        return False
    def load_model(self):
        self.calls.append("load_model")
    def get_crop(self, image, bbox):
        self.calls.append(("get_crop", bbox))
        return image
    def get_classification(self, crop):
        return [["Red deer", 0.5], ["fox", 0.3], ["wild boar", 0.2]]
    def get_class_names(self):
        return {"1": "Red deer", "2": "fox", "3": "wild boar"}
'''


def _model_dir(tmp_path: Path, source: str = FAKE_INFERENCE) -> Path:
    model_dir = tmp_path / "EUR-DF-v1-4"
    model_dir.mkdir()
    (model_dir / "inference.py").write_text(source)
    return model_dir


class TestLoadInference:
    def test_instantiates_with_the_weights_path(self, tmp_path):
        model_dir = _model_dir(tmp_path)
        inference = load_inference(model_dir, "w.pt")
        assert inference.model_dir == model_dir
        assert inference.model_path == model_dir / "w.pt"

    def test_a_script_missing_the_contract_is_refused(self, tmp_path):
        model_dir = _model_dir(tmp_path, "class ModelInference:\n    def load_model(self): pass\n")
        with pytest.raises(RuntimeError, match="lacks check_gpu"):
            load_inference(model_dir, "w.pt")


class TestPickSpecies:
    probs = {"red_deer": 0.5, "fox": 0.3, "wild_boar": 0.2}

    def test_no_filter_is_the_plain_top1(self):
        assert pick_species(self.probs, None) == ("red_deer", 0.5)

    def test_filter_renormalises_over_the_included_species(self):
        label, confidence = pick_species(self.probs, ["fox", "wild_boar"])
        assert label == "fox"
        assert confidence == pytest.approx(0.3 / 0.5)

    def test_a_filter_that_leaves_nothing_falls_back_to_every_label(self):
        assert pick_species(self.probs, ["lynx"]) == ("red_deer", 0.5)
        assert pick_species(self.probs, []) == ("red_deer", 0.5)


class TestLoad:
    def test_checks_the_labels_against_the_taxonomy_csv(self, tmp_path):
        # The fake knows three of DeepFaune's 38 classes
        model_dir = _model_dir(tmp_path)
        with pytest.raises(RuntimeError, match="differ from taxonomy.csv"):
            load(get_model(DEEPFAUNE_ID), model_dir, "cpu")

    def test_calls_check_gpu_then_load_model(self, tmp_path, monkeypatch):
        model_dir = _model_dir(tmp_path)
        monkeypatch.setattr(fixed_model, "class_labels", lambda model_id: ["fox", "red_deer", "wild_boar"])
        loaded = load(get_model(DEEPFAUNE_ID), model_dir, "cpu")
        assert loaded.inference.calls == ["check_gpu", "load_model"]


class TestClassify:
    def test_crops_each_animal_and_normalises_the_labels(self, tmp_path):
        model_dir = _model_dir(tmp_path)
        image_path = tmp_path / "img.jpg"
        Image.new("RGB", (10, 10)).save(image_path)
        model = FixedModel(get_model(DEEPFAUNE_ID), load_inference(model_dir, "w.pt"))
        detections = [
            DetectionInfo(1, "animal", 0.9, [0.1, 0.1, 0.5, 0.5], 10, 10),
            DetectionInfo(2, "person", 0.9, [0.0, 0.0, 0.5, 0.5], 10, 10),
            DetectionInfo(3, "animal", 0.8, [0.2, 0.2, 0.3, 0.3], 10, 10),
        ]
        project = ProjectConfig(project_id=1, classification_model=DEEPFAUNE_ID, included_species=["fox"])

        results = model.classify(str(image_path), detections, project)

        assert [(r.detection_id, r.species, r.confidence) for r in results] == [(1, "fox", 1.0), (3, "fox", 1.0)]
        assert [c for c in model.inference.calls if c != "check_gpu"] == [
            ("get_crop", (0.1, 0.1, 0.5, 0.5)), ("get_crop", (0.2, 0.2, 0.3, 0.3)),
        ]
        assert results[0].raw_prediction is None
