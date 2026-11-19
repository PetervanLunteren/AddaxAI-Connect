"""Deployments after a curation delete.

A delete rebuilds the cameras' deployments (shared/deployment_rebuild.py),
which drops a deployment that lost all its photos unless a statement placed
the camera there. Pinned here, read from the source:

- Only the delete path rebuilds. Bulk hide must not: hidden photos stay part
  of their deployment, so an unhide finds everything as it was.
- The rebuild reads every photo of the camera, hidden ones included. A
  deployment holding only hidden photos must survive.
- The bulk delete stays capped per request. Uncapped, a 2,174-image delete
  took 68 s and 504'd at nginx's 60 s while the server finished anyway.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

REPO = Path(__file__).resolve().parents[2]
IMAGE_ADMIN = Path(_api) / "routers" / "image_admin.py"


def _function_node(path: Path, function_name: str) -> ast.AST:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            return node
    raise AssertionError(f"{function_name} not found in {path}")


def _function_calls(path: Path, function_name: str) -> set[str]:
    return {
        call.func.id
        for call in ast.walk(_function_node(path, function_name))
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Name)
    }


def test_delete_rebuilds_and_hide_does_not():
    assert "rebuild_after_delete" in _function_calls(IMAGE_ADMIN, "delete_images_by_ids")
    hide = _function_calls(IMAGE_ADMIN, "bulk_hide_images")
    assert "rebuild_after_delete" not in hide and "rebuild" not in hide


def test_the_rebuild_reads_hidden_photos_too():
    node = _function_node(REPO / "shared" / "shared" / "deployment_rebuild.py", "rebuild_camera")
    assert "is_hidden" not in ast.dump(node)


def test_bulk_delete_is_capped_per_request():
    node = _function_node(IMAGE_ADMIN, "bulk_delete_images")
    assert "BULK_DELETE_MAX_IMAGES" in ast.dump(node)
