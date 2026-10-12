"""Privacy removal in the classification workers, pinned on both twins.

The worker modules import torch and the model loaders, so these tests read
the source files and cut out the functions with ast instead of importing.
"""
import ast
import os

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORKERS = {
    "deepfaune": os.path.join(_ROOT, "services", "classification-deepfaune", "worker.py"),
    "speciesnet": os.path.join(_ROOT, "services", "classification-speciesnet", "worker.py"),
}
NEW_FUNCTIONS = ("event_location_and_timestamp", "publish_person_vehicle_events", "remove_private_image")


def _source(name: str) -> str:
    with open(WORKERS[name], encoding="utf-8") as handle:
        return handle.read()


def _function(source: str, func_name: str) -> str:
    tree = ast.parse(source)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            return ast.get_source_segment(source, node)
    raise AssertionError(f"{func_name} not found")


@pytest.mark.parametrize("worker", sorted(WORKERS))
class TestHook:
    def test_removal_runs_before_any_download(self, worker):
        src = _function(_source(worker), "process_detection_complete")
        hook = src.index("remove_private_image(")
        assert hook < src.index("animal_detections = ")
        assert hook < src.index("download_image_from_minio(")

    def test_removal_is_decided_by_the_shared_rule(self, worker):
        src = _function(_source(worker), "remove_private_image")
        assert "removed_categories(detections, project)" in src
        assert "PRIVACY_CATEGORIES" in src
        assert '"person", "vehicle"' not in src

    def test_objects_go_before_the_stamp(self, worker):
        src = _function(_source(worker), "remove_private_image")
        assert src.index("replace_with_placeholder(") < src.index("privacy_removed_at =")
        assert src.index("privacy_removed_at =") < src.index('update_image_status(image_uuid, "classified")')

    def test_alerts_go_out_without_a_photo_and_never_for_bulk(self, worker):
        src = _function(_source(worker), "remove_private_image")
        assert "if not is_bulk:" in src
        assert 'pv_dets, None, message.get("timestamp")' in src

    def test_a_failed_publish_loses_the_alert_not_the_image(self, worker):
        # Same rule as both branches: the placeholder is written and the row
        # stamped by then, so a Redis hiccup must not fail the image.
        src = _function(_source(worker), "remove_private_image")
        publish = src.index("publish_person_vehicle_events(")
        assert src.rindex("try:", 0, publish) > src.index("replace_with_placeholder(")
        assert "except Exception as e:" in src[publish:]


@pytest.mark.parametrize("worker", sorted(WORKERS))
class TestOnePublishPath:
    """The person/vehicle event is built in one function; the hook and both
    branches call it, so the payload cannot drift between them."""

    def test_the_event_loop_exists_once(self, worker):
        assert _source(worker).count("Published person/vehicle detection notification") == 1

    def test_called_from_the_hook_and_both_branches(self, worker):
        src = _source(worker)
        # the def plus three calls
        assert src.count("publish_person_vehicle_events(") == 4
        assert "publish_person_vehicle_events(" in _function(src, "remove_private_image")


def test_the_twins_share_the_same_privacy_code():
    for func_name in NEW_FUNCTIONS:
        assert _function(_source("deepfaune"), func_name) == _function(_source("speciesnet"), func_name)
