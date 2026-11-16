"""Tests for how the API sends bytes, and for keeping the blur off the event loop.

The rules and the numbers behind them are in DEVELOPERS.md, "Sending bytes
from the API".
"""
import ast
import inspect
import io
import os
import sys
import textwrap
from pathlib import Path

import pytest
from fastapi import Response
from PIL import Image as PILImage

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Image

API_ROOT = Path(_api)
BLUR_FUNCTIONS = {"apply_privacy_blur", "blur_whole_image"}
_FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


def _name(node: ast.AST) -> str | None:
    """`foo` for both `foo(...)` and `module.foo(...)`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _yields(function: ast.AST) -> bool:
    """True when the function's own body yields. A yield inside a nested
    function makes that one a generator, not the function around it."""
    todo = list(ast.iter_child_nodes(function))
    while todo:
        node = todo.pop()
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            return True
        if not isinstance(node, _FUNCTIONS):
            todo.extend(ast.iter_child_nodes(node))
    return False


def _generator_names(tree: ast.AST) -> set[str]:
    """Names of every generator function in a module, nested ones included."""
    return {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and _yields(node)
    }


def _streaming_without_generator(tree: ast.AST) -> list[int]:
    """Line numbers of StreamingResponse calls whose content is not a call to
    a generator function. The generator must be defined in the same file: one
    imported from another module is flagged too, so keep it next to its use."""
    generators = _generator_names(tree)
    lines = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and _name(node.func) == "StreamingResponse"):
            continue
        content = node.args[0] if node.args else next(
            (kw.value for kw in node.keywords if kw.arg == "content"), None
        )
        if not (isinstance(content, ast.Call) and _name(content.func) in generators):
            lines.append(node.lineno)
    return lines


def _jpeg(width: int = 64, height: int = 48) -> bytes:
    buffer = io.BytesIO()
    PILImage.new("RGB", (width, height), (120, 80, 40)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _image() -> Image:
    return Image(
        uuid="11111111-2222-3333-4444-555555555555",
        filename="IMG_0001.JPG",
        storage_path="cam/IMG_0001.JPG",
    )


class TestStreamingOnlyForGenerators:
    def test_every_streaming_response_gets_a_generator(self):
        offenders = [
            f"{path.relative_to(API_ROOT)}:{line}"
            for path in sorted(API_ROOT.rglob("*.py"))
            for line in _streaming_without_generator(ast.parse(path.read_text()))
        ]
        assert not offenders, (
            "StreamingResponse is only for a generator. Send bytes that are "
            f"already in memory as Response(content=...): {offenders}"
        )

    def test_the_guard_catches_the_old_pattern(self):
        # Without this, a guard that never matches anything would pass forever
        tree = ast.parse("StreamingResponse(io.BytesIO(data), media_type='image/jpeg')")
        assert _streaming_without_generator(tree) == [1]

    def test_the_guard_accepts_a_real_generator(self):
        tree = ast.parse(textwrap.dedent("""
            def handler():
                def stream():
                    yield "a"
                return StreamingResponse(stream())
        """))
        assert _streaming_without_generator(tree) == []


class TestImageResponses:
    @pytest.mark.asyncio
    async def test_full_image_goes_out_in_one_piece(self, monkeypatch):
        from routers import images

        data = _jpeg()

        class FakeStorage:
            async def download_fileobj_async(self, bucket: str, object_name: str) -> bytes:
                return data

        monkeypatch.setattr(images, "StorageClient", FakeStorage)

        response = await images._image_from_storage(_image(), cache_max_age=86400)

        assert type(response) is Response
        assert response.body == data
        assert response.headers["content-length"] == str(len(data))
        assert response.media_type == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=86400"
        assert response.headers["etag"] == '"11111111-2222-3333-4444-555555555555"'

    @pytest.mark.asyncio
    async def test_full_blur_is_a_plain_uncached_jpeg(self):
        from routers.images import _full_blur_response

        response = await _full_blur_response(_jpeg(400, 300), _image())

        assert type(response) is Response
        assert response.media_type == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=0"
        assert response.headers["content-length"] == str(len(response.body))
        assert PILImage.open(io.BytesIO(response.body)).size == (400, 300)


class TestBlurRunsInAThread:
    """Through asyncio.to_thread the blur function is passed as an argument,
    never called. So any direct call to it in these handlers blocks the event
    loop and is a regression."""

    def _direct_blur_calls(self, source: str) -> list[int]:
        return [
            node.lineno
            for node in ast.walk(ast.parse(textwrap.dedent(source)))
            if isinstance(node, ast.Call) and _name(node.func) in BLUR_FUNCTIONS
        ]

    def test_image_endpoints(self):
        source = (API_ROOT / "routers" / "images.py").read_text()
        assert self._direct_blur_calls(source) == []

    def test_rejected_file_image(self):
        from routers.live_feed import get_rejection_image

        assert self._direct_blur_calls(inspect.getsource(get_rejection_image)) == []
