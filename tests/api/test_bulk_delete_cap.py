"""The bulk delete stays capped per request. Uncapped, a 2,174-image delete
took 68 s and 504'd at nginx's 60 s while the server finished anyway. Read
from the source, because the route needs a database to call. What a delete
does to deployments is tested in tests/db_api/test_image_delete.py.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

IMAGE_ADMIN = Path(_api) / "routers" / "image_admin.py"


def _function_node(path: Path, function_name: str) -> ast.AST:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            return node
    raise AssertionError(f"{function_name} not found in {path}")


def test_bulk_delete_is_capped_per_request():
    node = _function_node(IMAGE_ADMIN, "bulk_delete_images")
    assert "BULK_DELETE_MAX_IMAGES" in ast.dump(node)
