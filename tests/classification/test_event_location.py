"""Alerts and integrations get the photo's GPS from the columns, never from the
raw EXIF.

A photo with an invalid reading such as (0, 0) is accepted. Its gps_lat and gps_lon are empty, but its EXIF still
holds the (0, 0), which EarthRanger and Sensing Clues would take as a real
place. Read from the source, because the worker needs the ML packages to
import.
"""
import ast
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def _function_source(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.unparse(node)
    raise AssertionError(f"{name} not found in {path}")


def test_the_event_location_reads_the_gps_columns():
    body = _function_source(REPO / "services" / "classification" / "worker.py", "event_location_and_timestamp")
    assert "gps_lat" in body and "gps_lon" in body
    assert "gps_decimal" not in body


def test_the_observations_export_reads_the_gps_columns():
    body = _function_source(REPO / "services" / "api" / "routers" / "export.py", "_build_observation_rows")
    assert "gps_lat" in body
    assert "gps_decimal" not in body
