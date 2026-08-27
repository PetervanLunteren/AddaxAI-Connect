"""Tests for the whole-frame blur used when the detector has not run.

The privacy blur is applied on read from the Detection rows of an image. An
image that has not been through detection has none, which looks exactly like a
classified frame holding no people, so the raw bytes went out. That covered the
live feed, the camera updates thumbnails and, permanently, every rejected file,
which never reaches the detector at all.

The rule now: when the project hides people or vehicles and we cannot tell where
they are, the whole frame is blurred instead of nothing.
"""
import inspect
import io
import os
import sys

import pytest
from PIL import Image as PILImage
from PIL import ImageStat

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Image, Project

from utils.image_processing import FULL_BLUR_LONG_SIDE, blur_whole_image


def _scene(width: int, height: int) -> bytes:
    """A bright top half over a dark bottom half, with a small red square in
    the middle standing in for a person. The square is 1% of the width, so the
    same scene at any resolution is directly comparable."""
    img = PILImage.new("RGB", (width, height), (30, 30, 30))
    img.paste(PILImage.new("RGB", (width, height // 2), (200, 200, 200)), (0, 0))
    side = max(1, round(width / 100))
    img.paste(
        PILImage.new("RGB", (side, side), (255, 0, 0)),
        (width // 2 - side // 2, height // 2 - side // 2),
    )
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95)
    return buffer.getvalue()


def _colourfulness(pixel) -> int:
    """Spread between the colour channels. 255 for pure red, near 0 for grey."""
    return max(pixel) - min(pixel)


class TestBlurWholeImage:
    def test_the_subject_colour_is_destroyed(self):
        # A pure red square is unmistakable before the blur and must be
        # indistinguishable from its grey surroundings after it
        data = _scene(4000, 3000)
        before = PILImage.open(io.BytesIO(data)).getpixel((2000, 1500))
        after = PILImage.open(io.BytesIO(blur_whole_image(data))).getpixel((2000, 1500))

        assert _colourfulness(before) > 200
        assert _colourfulness(after) < 25

    def test_scene_layout_survives(self):
        # The live feed still has to show whether a camera points at the sky,
        # so bright above dark must stay bright above dark
        blurred = PILImage.open(io.BytesIO(blur_whole_image(_scene(4000, 3000))))
        top = ImageStat.Stat(blurred.crop((0, 0, 4000, 1500))).mean[0]
        bottom = ImageStat.Stat(blurred.crop((0, 1500, 4000, 3000))).mean[0]

        assert top > 150
        assert bottom < 80

    @pytest.mark.parametrize("size", [(4000, 3000), (512, 384), (100, 75)])
    def test_strength_does_not_depend_on_resolution(self, size):
        # A full-size original and a thumbnail must end up equally unreadable,
        # otherwise the filmstrip and the focus image would disagree
        width, height = size
        blurred = PILImage.open(io.BytesIO(blur_whole_image(_scene(width, height))))

        assert _colourfulness(blurred.getpixel((width // 2, height // 2))) < 25

    def test_dimensions_are_unchanged(self):
        blurred = PILImage.open(io.BytesIO(blur_whole_image(_scene(4000, 3000))))

        assert blurred.size == (4000, 3000)
        assert blurred.format == "JPEG"

    def test_image_smaller_than_the_target_does_not_crash(self):
        # Nothing stops a camera or a rejected file from being tiny
        tiny = PILImage.new("RGB", (10, 8), (255, 0, 0))
        buffer = io.BytesIO()
        tiny.save(buffer, format="JPEG", quality=95)

        blurred = PILImage.open(io.BytesIO(blur_whole_image(buffer.getvalue())))

        assert blurred.size == (10, 8)

    def test_greyscale_input_is_handled(self):
        # Camera traps send night shots in mode L
        grey = PILImage.new("L", (800, 600), 128)
        buffer = io.BytesIO()
        grey.save(buffer, format="JPEG", quality=95)

        blurred = PILImage.open(io.BytesIO(blur_whole_image(buffer.getvalue())))

        assert blurred.size == (800, 600)
        assert blurred.mode == "RGB"

    def test_target_is_small_enough_to_be_unrecognisable(self):
        # A face filling the whole frame lands at roughly half the long side.
        # Well under any recognition threshold, and the number is the reason
        # the blur works, so it is not free to drift upwards unnoticed.
        assert FULL_BLUR_LONG_SIDE <= 32


class TestNeedsFullBlur:
    """The one rule that decides between a per-box blur and a whole frame."""

    def _project(self, people: bool = True, vehicles: bool = True) -> Project:
        return Project(name="p", blur_people=people, blur_vehicles=vehicles)

    def _image(self, status: str) -> Image:
        return Image(uuid="u", filename="a.jpg", status=status)

    @pytest.mark.parametrize("status", ["pending", "processing", "failed"])
    def test_blurs_everything_before_detection_has_run(self, status):
        from routers.images import needs_full_blur

        assert needs_full_blur(self._image(status), self._project()) is True

    @pytest.mark.parametrize("status", ["detected", "classifying", "classified"])
    def test_leaves_detected_images_to_the_per_box_blur(self, status):
        from routers.images import needs_full_blur

        assert needs_full_blur(self._image(status), self._project()) is False

    @pytest.mark.parametrize("status", ["pending", "processing", "failed", "classified"])
    def test_a_project_that_blurs_nothing_is_untouched(self, status):
        # Turning both toggles off must change nothing anywhere
        from routers.images import needs_full_blur

        project = self._project(people=False, vehicles=False)
        assert needs_full_blur(self._image(status), project) is False

    def test_vehicles_only_project_still_hides_people(self):
        # A whole-frame blur cannot pick and choose, so a project that only
        # asked for vehicles also gets its people hidden before detection.
        # Over-blurring in the safe direction, decided deliberately.
        from routers.images import needs_full_blur

        project = self._project(people=False, vehicles=True)
        assert needs_full_blur(self._image("pending"), project) is True

    def test_missing_project_does_not_crash(self):
        # The serve paths pass None when the project cannot be loaded
        from routers.images import needs_full_blur

        assert needs_full_blur(self._image("pending"), None) is False

    def test_unknown_status_fails_closed(self):
        # A status added later must blur rather than leak until someone
        # deliberately adds it to the detected set
        from routers.images import needs_full_blur

        assert needs_full_blur(self._image("quarantined"), self._project()) is True


class TestServePathsAreCovered:
    """Every path that hands out image bytes has to apply the rule, and the
    result must not be cached, because it is replaced by the per-box blur the
    moment detection finishes."""

    @pytest.mark.parametrize(
        "func_name", ["get_image_thumbnail", "get_image_full", "get_annotated_image"]
    )
    def test_every_image_endpoint_applies_the_rule(self, func_name):
        from routers import images

        src = inspect.getsource(getattr(images, func_name))
        assert "needs_full_blur" in src

    def test_full_blur_response_is_not_cached(self):
        from routers.images import _full_blur_response

        src = inspect.getsource(_full_blur_response)
        assert "max-age=0" in src

    def test_annotated_full_blur_is_not_cached(self):
        from routers.images import get_annotated_image

        src = inspect.getsource(get_annotated_image)
        assert "max-age=0" in src

    def test_the_rule_uses_the_blur_categories_helper(self):
        # Same requirement as every other blur consumer, one source of truth
        # for which categories a project hides
        from routers.images import needs_full_blur

        src = inspect.getsource(needs_full_blur)
        assert "blur_categories()" in src
        assert '"person", "vehicle"' not in src

    def test_rejected_files_are_blurred_whole(self):
        # A rejected file has no image row and never reaches the detector, so
        # the whole frame is the only option
        from routers.live_feed import get_rejection_image

        src = inspect.getsource(get_rejection_image)
        assert "blur_whole_image" in src
        assert "blur_categories()" in src

    def test_the_feed_caption_asks_the_same_question_as_the_serve_path(self):
        # The page captions the focus image with why it is unreadable. That
        # flag must come from the rule itself, not from a second copy of the
        # status list in TypeScript, or the caption and the pixels can disagree
        from routers.live_feed import get_live_feed

        src = inspect.getsource(get_live_feed)
        assert "fully_blurred=needs_full_blur(image, project)" in src
        # A rejected file never reaches the detector, so only the project
        # setting decides for those
        assert "fully_blurred=project_blurs" in src
        assert "blur_categories()" in src

    def test_undecodable_rejected_file_is_not_served(self):
        # The rejected tree also holds daily reports and other non-images. If
        # the bytes cannot be blurred they must not go out raw instead.
        from routers.live_feed import get_rejection_image

        src = inspect.getsource(get_rejection_image)
        # OSError from the blur, ValueError from the on-the-fly thumbnail
        handler = src.split("except (OSError, ValueError):", 1)[1]
        assert handler.lstrip().startswith("raise HTTPException"), (
            "A file that cannot be blurred must be refused, never fall through "
            "to serving the raw bytes"
        )
        assert "HTTP_415_UNSUPPORTED_MEDIA_TYPE" in src

    def test_blur_whole_image_rejects_a_non_image(self):
        # The guard above only helps if this really raises OSError
        with pytest.raises(OSError):
            blur_whole_image(b"camera_id=CAM-1\nbattery=90\n")
