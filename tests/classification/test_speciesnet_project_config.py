"""Where the SpeciesNet worker reads its project config.

The config (country, and the taxonomy mapping) belongs to the image's
project and is read per image. It must come after every early return in
process_detection_complete: an image without detections, a photo removed for
privacy, or an image with only people and vehicles never depends on it, so
a missing config can never fail those images or drop their alerts. The
worker module imports torch, so this reads the source, like
test_privacy_removal.
"""
import ast
import os

_WORKER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "classification-speciesnet", "worker.py",
))


def _function_source(name: str) -> str:
    with open(_WORKER, encoding="utf-8") as handle:
        source = handle.read()
    for node in ast.parse(source).body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(source, node)
    raise AssertionError(f"{name} not found")


def test_config_is_read_after_the_early_returns_and_before_the_download():
    body = _function_source("process_detection_complete")
    config = body.index("get_project_geofence(project_id)")
    assert body.index("animal_detections = ") < config
    assert body.index('logger.info("Image processing complete (no animals)"') < config
    assert config < body.index("download_image_from_minio(storage_path)")
    assert config < body.index("run_classification(")


def test_no_server_wide_config_wait_at_startup():
    main = _function_source("main")
    assert "get_geofencing_config" not in main
    assert "Country code not configured" not in main
