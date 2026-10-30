"""Per-detection geofence and rollup in the SpeciesNet classifier.

speciesnet_model.py imports speciesnet and the database, so these tests cut
the functions out of the source with ast and run them against stand-ins for
the two speciesnet functions. What they pin is the order of the calls, the
reference pipeline in run_md_and_speciesnet: geofence first, rollup only
when the geofence did not already roll up.
"""
import ast
import os
from types import SimpleNamespace
from typing import Any, List, Optional

_CLASSIFIER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "classification", "speciesnet_model.py",
))
FUNCTIONS = ("speciesnet_admin1", "geofence_and_roll_up")
CONSTANTS = ("ROLLUP_TARGET_CONFIDENCE", "ROLLUP_LEVELS")

CLASSES = ["fox-label", "jackal-label", "wolf-label", "dog-label", "cat-label"]
SCORES = [0.5, 0.2, 0.1, 0.1, 0.1]
ENSEMBLE = SimpleNamespace(taxonomy_map={"t": "t"}, geofence_map={"g": "g"})


def _source() -> str:
    with open(_CLASSIFIER, encoding="utf-8") as handle:
        return handle.read()


def _load(geofence_result=None, rollup_result=None):
    """The two functions, with recording stand-ins for the speciesnet calls."""
    calls = {"geofence": [], "rollup": []}

    def geofence_animal_classification(**kwargs):
        calls["geofence"].append(kwargs)
        return geofence_result or (kwargs["labels"][0], kwargs["scores"][0], "classifier")

    def roll_up_labels_to_first_matching_level(**kwargs):
        calls["rollup"].append(kwargs)
        return rollup_result

    namespace = {
        "Any": Any, "List": List, "Optional": Optional,
        "geofence_animal_classification": geofence_animal_classification,
        "roll_up_labels_to_first_matching_level": roll_up_labels_to_first_matching_level,
    }
    source = _source()
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and node.targets[0].id in CONSTANTS:
            exec(ast.get_source_segment(source, node), namespace)
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS:
            exec(ast.get_source_segment(source, node), namespace)
    return namespace, calls


def test_admin1_drops_the_country_prefix():
    ns, _ = _load()
    assert ns["speciesnet_admin1"]("US-CA") == "CA"
    assert ns["speciesnet_admin1"]("CA") == "CA"
    assert ns["speciesnet_admin1"](None) is None
    assert ns["speciesnet_admin1"]("") is None


def test_no_country_skips_geofence_and_rolls_up_without_it():
    ns, calls = _load(rollup_result=("canid-label", 0.9, "classifier+rollup_to_family"))
    label, score = ns["geofence_and_roll_up"](CLASSES, SCORES, ENSEMBLE, None, None)
    assert (label, score) == ("canid-label", 0.9)
    assert calls["geofence"] == []
    assert calls["rollup"][0]["enable_geofence"] is False


def test_allowed_top1_still_gets_the_confidence_rollup():
    ns, calls = _load(rollup_result=("canid-label", 0.9, "classifier+rollup_to_family"))
    label, _ = ns["geofence_and_roll_up"](CLASSES, SCORES, ENSEMBLE, "NLD", None)
    assert label == "canid-label"
    assert len(calls["geofence"]) == 1
    assert calls["rollup"][0]["enable_geofence"] is True
    assert calls["rollup"][0]["target_taxonomy_levels"] == [
        "species", "genus", "family", "order", "class", "kingdom",
    ]
    assert calls["rollup"][0]["non_blank_threshold"] == 0.65


def test_geofenced_top1_is_not_rolled_up_again():
    ns, calls = _load(geofence_result=("canid-label", 0.6, "classifier+geofence+rollup_to_family"))
    label, score = ns["geofence_and_roll_up"](CLASSES, SCORES, ENSEMBLE, "NLD", "CA")
    assert (label, score) == ("canid-label", 0.6)
    assert calls["geofence"][0]["admin1_region"] == "CA"
    assert calls["rollup"] == []


def test_no_rollup_level_keeps_the_top1():
    ns, _ = _load(rollup_result=None)
    assert ns["geofence_and_roll_up"](CLASSES, SCORES, ENSEMBLE, "NLD", None) == ("fox-label", 0.5)


def test_whole_image_combiner_is_not_used():
    # ensemble.combine() picks one label per image and applies detector rules
    # for people, vehicles and blanks; it is not meant for single detections.
    assert ".combine(" not in _source()
