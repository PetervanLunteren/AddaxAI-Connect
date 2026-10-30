"""Where the worker reads the image's model and project config.

The model belongs to the image's project and loads on first use, and a
SpeciesNet project's config (country, and the taxonomy mapping) is read per
image. Both must come after every early return in
process_detection_complete: an image without detections, a photo removed for
privacy, or an image with only people and vehicles never depends on them, so
a missing config or a failing model load can never fail those images or drop
their alerts. The worker module imports torch, so this reads the source,
like test_privacy_removal.
"""
import ast
import os

_WORKER = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "classification", "worker.py",
))


def _function_source(name: str) -> str:
    with open(_WORKER, encoding="utf-8") as handle:
        source = handle.read()
    for node in ast.parse(source).body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(source, node)
    raise AssertionError(f"{name} not found")


def test_model_is_taken_after_the_early_returns_and_before_the_download():
    body = _function_source("process_detection_complete")
    model = body.index("registry.get(project.classification_model)")
    assert body.index("animal_detections = ") < model
    assert body.index('logger.info("Image processing complete (no animals)"') < model
    assert model < body.index("download_image_from_minio(storage_path)")
    assert model < body.index("model.classify(")


def test_speciesnet_reads_its_project_config_per_image():
    path = os.path.join(os.path.dirname(_WORKER), "speciesnet_model.py")
    with open(path, encoding="utf-8") as handle:
        source = handle.read()
    classify = source.index("def classify(")
    assert "get_project_species_config(project.project_id)" in source[classify:]


def test_startup_loads_the_models_in_use_and_nothing_else_waits():
    main = _function_source("main")
    assert "registry.load_all(models_in_use())" in main
    assert "time.sleep" not in main
    assert "get_project_species_config" not in main
