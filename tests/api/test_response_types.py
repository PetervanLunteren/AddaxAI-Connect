"""Tests for how the API sends bytes, and for keeping the blur off the event loop.

StreamingResponse iterates its content. A BytesIO is iterated line by line, so
it is split on every newline byte, and a JPEG is full of them: a 2.3 MB photo
went out as 15,586 pieces and took 3.5 s to send, against under 1 ms as a plain
Response. Bytes that are already in memory therefore go out as a Response, and
StreamingResponse is only for a generator.

The privacy blur decodes, blurs and re-encodes a whole photo. Run directly in
an async handler it blocks every other request on that worker, so the image
endpoints run it in a thread.
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
from fastapi.responses import StreamingResponse
from PIL import Image as PILImage

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Image

API_ROOT = Path(_api)
BLUR_FUNCTIONS = {"apply_privacy_blur", "blur_whole_image"}


def _name(node: ast.AST) -> str | None:
    """`foo` for both `foo(...)` and `module.foo(...)`."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


_FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)


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


def _jpeg(width: int = 64, height: int = 48) -> bytes:
    buffer = io.BytesIO()
    PILImage.new("RGB", (width, height), (120, 80, 40)).save(buffer, format="JPEG")
    return buffer.getvalue()


class TestStreamingOnlyForGenerators:
    def test_every_streaming_response_gets_a_generator(self):
        offenders = []
        for path in sorted(API_ROOT.rglob("*.py")):
            tree = ast.parse(path.read_text(), filename=str(path))
            generators = _generator_names(tree)
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Call) and _name(node.func) == "StreamingResponse"):
                    continue
                content = node.args[0] if node.args else next(
                    (kw.value for kw in node.keywords if kw.arg == "content"), None
                )
                if not (isinstance(content, ast.Call) and _name(content.func) in generators):
                    offenders.append(f"{path.relative_to(API_ROOT)}:{node.lineno}")

        assert not offenders, (
            "StreamingResponse is only for a generator. Send bytes that are "
            f"already in memory as Response(content=...): {offenders}"
        )

    def test_the_guard_catches_the_old_pattern(self):
        # Without this, a guard that never matches anything would pass forever
        tree = ast.parse("StreamingResponse(io.BytesIO(data), media_type='image/jpeg')")
        call = tree.body[0].value
        assert _name(call.func) == "StreamingResponse"
        assert _name(call.args[0].func) not in _generator_names(tree)

    def test_the_guard_accepts_a_real_generator(self):
        tree = ast.parse(textwrap.dedent("""
            def handler():
                def stream():
                    yield "a"
                return StreamingResponse(stream())
        """))
        assert _generator_names(tree) == {"stream"}


class _FakeStorage:
    def __init__(self, data: bytes):
        self.data = data
        self.calls = []

    async def download_fileobj_async(self, bucket: str, object_name: str) -> bytes:
        self.calls.append((bucket, object_name))
        return self.data


def _image() -> Image:
    return Image(
        uuid="11111111-2222-3333-4444-555555555555",
        filename="IMG_0001.JPG",
        storage_path="cam/IMG_0001.JPG",
        thumbnail_path="cam/IMG_0001_thumb.jpg",
    )


class TestImageResponses:
    @pytest.mark.asyncio
    async def test_full_image_goes_out_in_one_piece(self, monkeypatch):
        from routers import images

        data = _jpeg()
        storage = _FakeStorage(data)
        monkeypatch.setattr(images, "StorageClient", lambda: storage)

        response = await images._image_from_storage(_image(), cache_max_age=86400)

        assert type(response) is Response
        assert not isinstance(response, StreamingResponse)
        assert response.body == data
        assert response.headers["content-length"] == str(len(data))
        assert response.media_type == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=86400"
        assert response.headers["etag"] == '"11111111-2222-3333-4444-555555555555"'
        assert storage.calls == [("raw-images", "cam/IMG_0001.JPG")]

    @pytest.mark.asyncio
    async def test_thumbnail_comes_from_the_thumbnail_bucket(self, monkeypatch):
        from routers import images

        storage = _FakeStorage(_jpeg())
        monkeypatch.setattr(images, "StorageClient", lambda: storage)

        response = await images._image_from_storage(_image(), use_thumbnail=True)

        assert response.headers["cache-control"] == "private, max-age=3600"
        assert storage.calls == [("thumbnails", "cam/IMG_0001_thumb.jpg")]

    @pytest.mark.asyncio
    async def test_full_blur_is_a_plain_uncached_jpeg(self):
        from routers.images import _full_blur_response

        response = await _full_blur_response(_jpeg(400, 300), _image())

        assert type(response) is Response
        assert response.media_type == "image/jpeg"
        assert response.headers["cache-control"] == "private, max-age=0"
        assert response.headers["etag"] == '"11111111-2222-3333-4444-555555555555-fullblur"'
        assert response.headers["content-length"] == str(len(response.body))
        assert PILImage.open(io.BytesIO(response.body)).size == (400, 300)


class TestBlurRunsInAThread:
    """A direct call blocks the event loop. Through asyncio.to_thread the blur
    function is passed as an argument, never called, so any direct call to it
    in these endpoints is a regression."""

    def _direct_blur_calls(self, source: str) -> list[int]:
        tree = ast.parse(textwrap.dedent(source))
        return [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and _name(node.func) in BLUR_FUNCTIONS
        ]

    def test_image_endpoints(self):
        source = (API_ROOT / "routers" / "images.py").read_text()
        assert self._direct_blur_calls(source) == []
        assert source.count("asyncio.to_thread(") >= 5

    def test_rejected_file_image(self):
        from routers.live_feed import get_rejection_image

        source = inspect.getsource(get_rejection_image)
        assert self._direct_blur_calls(source) == []
        assert "asyncio.to_thread(blur_whole_image" in source
