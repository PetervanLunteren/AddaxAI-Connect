"""Per-detection rollup in the SpeciesNet classifier, and the check on the
vendored taxonomy.

speciesnet_model.py imports speciesnet and the database, so these tests cut
the functions out of the source with ast and run them against a stand-in for
the speciesnet rollup. What they pin: the rollup runs without a geofence,
the project's label CSV is what narrows the labels to a place, a classifier
result without a top-5 stops the image, and a vendored taxonomy that is not
the model's own stops the worker.
"""
import ast
import os
from types import SimpleNamespace
from typing import Any, List

import pytest

from shared.classification_models import (
    SPECIESNET_ID,
    TAXONOMY_DIR,
    ClassificationModel,
    speciesnet_taxa,
    taxon_names,
)

_CLASSIFIER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "classification", "speciesnet_model.py",
))
FUNCTIONS = ("roll_up", "read_top5", "check_vendored_taxonomy")
CONSTANTS = ("ROLLUP_TARGET_CONFIDENCE", "ROLLUP_LEVELS")

CLASSES = ["fox-label", "jackal-label", "wolf-label", "dog-label", "cat-label"]
SCORES = [0.5, 0.2, 0.1, 0.1, 0.1]
ENSEMBLE = SimpleNamespace(taxonomy_map={"t": "t"}, geofence_map={"g": "g"})
MODEL = SimpleNamespace(id=SPECIESNET_ID)


def _source() -> str:
    with open(_CLASSIFIER, encoding="utf-8") as handle:
        return handle.read()


def _load(rollup_result=None):
    """The functions, with a recording stand-in for the speciesnet rollup."""
    calls = []

    def roll_up_labels_to_first_matching_level(**kwargs):
        calls.append(kwargs)
        return rollup_result

    namespace = {
        "Any": Any, "List": List,
        "ClassificationModel": ClassificationModel,
        "speciesnet_taxa": speciesnet_taxa,
        "taxon_names": taxon_names,
        "roll_up_labels_to_first_matching_level": roll_up_labels_to_first_matching_level,
    }
    source = _source()
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and node.targets[0].id in CONSTANTS:
            exec(ast.get_source_segment(source, node), namespace)
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS:
            exec(ast.get_source_segment(source, node), namespace)
    return namespace, calls


def test_rollup_runs_without_a_geofence():
    ns, calls = _load(rollup_result=("canid-label", 0.9, "classifier+rollup_to_family"))
    assert ns["roll_up"](CLASSES, SCORES, ENSEMBLE) == ("canid-label", 0.9)
    assert calls[0]["enable_geofence"] is False
    assert calls[0]["country"] is None
    assert calls[0]["admin1_region"] is None


def test_rollup_uses_the_reference_levels_and_threshold():
    ns, calls = _load(rollup_result=("canid-label", 0.9, "classifier+rollup_to_family"))
    ns["roll_up"](CLASSES, SCORES, ENSEMBLE)
    assert calls[0]["target_taxonomy_levels"] == [
        "species", "genus", "family", "order", "class", "kingdom",
    ]
    assert calls[0]["non_blank_threshold"] == 0.65


def test_no_rollup_level_keeps_the_top1():
    ns, _ = _load(rollup_result=None)
    assert ns["roll_up"](CLASSES, SCORES, ENSEMBLE) == ("fox-label", 0.5)


def test_a_top5_is_read_from_the_result():
    ns, _ = _load()
    result = {"filepath": "a.jpg", "classifications": {"classes": CLASSES, "scores": SCORES}}
    assert ns["read_top5"](result) == (CLASSES, SCORES)


@pytest.mark.parametrize("result, named", [
    # speciesnet 5.0.6, issue #98: every animal was stored as unknown animal.
    ({"filepath": "a.jpg", "classifications_list": [{"classes": CLASSES, "scores": SCORES}]},
     "classifications_list"),
    ({"filepath": "a.jpg", "failures": ["CLASSIFIER"]}, "failures"),
    ({"filepath": "a.jpg", "classifications": {"classes": [], "scores": []}}, "classifications"),
])
def test_a_result_without_a_top5_stops_the_image(result, named):
    ns, _ = _load()
    with pytest.raises(RuntimeError, match=f"no classes, got .*{named}"):
        ns["read_top5"](result)


def test_nothing_is_geofenced():
    source = _source()
    assert "geofence_animal_classification" not in source
    assert "enable_geofence=True" not in source
    assert "geofence=True" not in source


def test_whole_image_combiner_is_not_used():
    # ensemble.combine() picks one label per image and applies detector rules
    # for people, vehicles and blanks; it is not meant for single detections.
    assert ".combine(" not in _source()


def _model_taxonomy_map() -> dict:
    """The ensemble's taxonomy map as speciesnet builds it from the model's
    taxonomy_release.txt: "class;order;family;genus;species" per line,
    without the "no cv result" line, which the package drops."""
    with open(TAXONOMY_DIR / f"{SPECIESNET_ID}.txt", encoding="utf-8") as handle:
        labels = [line.strip() for line in handle if "no cv result" not in line]
    return {";".join(label.split(";")[1:6]): label for label in labels}


def test_the_vendored_taxonomy_is_accepted_for_its_own_model():
    ns, _ = _load()
    ns["check_vendored_taxonomy"](MODEL, _model_taxonomy_map())


def test_a_model_with_another_taxonomy_stops_the_worker():
    ns, _ = _load()
    other = _model_taxonomy_map()
    other["mammalia;carnivora;canidae;newgenus;nova"] = "x"
    with pytest.raises(RuntimeError, match="differs from model_taxonomy"):
        ns["check_vendored_taxonomy"](MODEL, other)
