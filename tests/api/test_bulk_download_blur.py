"""Tests for the privacy blur on the bulk image download.

`POST /api/admin/images/download` used to zip the raw originals straight out of
the bucket. It was the last path in the app that handed out unblurred frames,
and the worst one to leave open: the zip is the largest artifact this app
produces and it leaves the server for good.

The rule now is the same one every other serve path follows. If the project
hides people or vehicles, the zip hides them too. There is no bulk reveal; an
admin who needs to identify somebody opens that one image and uses the reveal
in the detail view, which is logged per image.

Two things the blur must not break, both covered below:
- the capture time and GPS have to survive, or the zip is useless for
  archiving and for re-import,
- the EXIF thumbnail must NOT survive, because it is a small unblurred copy of
  the very frame we just blurred.
"""
import inspect
import io
import os
import struct
import sys

import pytest
from PIL import Image as PILImage

# Add API service to path so we can import the router directly
_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from shared.models import Detection, Image, Project

from utils.image_processing import _carried_exif, apply_privacy_blur, blur_whole_image


# The subject stands in for a person: a fine checkerboard, not a solid block.
# Detail is what a blur destroys and what makes a face recognisable. A flat
# rectangle would survive a Gaussian untouched in its middle and the test would
# pass on code that blurs nothing.
SUBJECT = (250, 240, 20)
BACKGROUND = (12, 110, 45)
SUBJECT_DARK = (10, 10, 10)
SUBJECT_BOX = (100, 100, 400, 500)  # x1, y1, x2, y2 in a 1200x900 frame
SUBJECT_CHECK = 4  # px per square, well under the blur radius of 25


def _frame(width: int = 1200, height: int = 900) -> PILImage.Image:
    img = PILImage.new("RGB", (width, height), BACKGROUND)
    x1, y1, x2, y2 = SUBJECT_BOX
    for x in range(x1, x2):
        for y in range(y1, y2):
            light = ((x // SUBJECT_CHECK) + (y // SUBJECT_CHECK)) % 2 == 0
            img.putpixel((x, y), SUBJECT if light else SUBJECT_DARK)
    return img


def _detail(img: PILImage.Image, box) -> float:
    """Standard deviation inside a box. High while the checkerboard is
    readable, near zero once it has been averaged away."""
    from PIL import ImageStat

    return ImageStat.Stat(img.crop(box).convert("L")).stddev[0]


CAPTURE_TIME = "2026:08:14 10:11:12"

TAG_MAKE = 0x010F
TAG_MODEL = 0x0110
TAG_DATETIME = 0x0132
TAG_EXIF_IFD = 0x8769
TAG_GPS_IFD = 0x8825
TAG_DATETIME_ORIGINAL = 0x9003

TYPE_ASCII = 2
TYPE_LONG = 4
TYPE_RATIONAL = 5


def _exif_with_thumbnail(img: PILImage.Image) -> bytes:
    """Build an EXIF block shaped like a real camera file: IFD0, an Exif
    sub-IFD holding DateTimeOriginal, a GPS sub-IFD, and an IFD1 thumbnail.

    Assembled byte by byte on purpose, rather than through Pillow's own EXIF
    writer. Two reasons, both learned the hard way:

    - Pillow cannot write an IFD1 thumbnail at all, and the thumbnail is the
      thing that must not leak. Without one, the leak test passes on broken
      code.
    - Pillow 10.2.0, the version pinned in the container, does not serialise
      the Exif and GPS sub-IFDs either. A fixture built with it would carry no
      capture time and no GPS, so the tests that check those survive the blur
      would quietly assert nothing on the version that actually ships.

    Reading is fine on both versions; only writing differs. So the fixture is
    hand-built and the tests then hold on any Pillow.
    """
    def ascii_value(text: str) -> bytes:
        return text.encode("ascii") + b"\x00"

    def rationals(*pairs) -> bytes:
        return b"".join(struct.pack(">II", n, d) for n, d in pairs)

    def entry(tag: int, typ: int, count: int, payload: bytes) -> bytes:
        # Values of 4 bytes or fewer sit inline, longer ones are an offset
        return struct.pack(">HHI", tag, typ, count) + payload

    thumb_buffer = io.BytesIO()
    thumb = img.copy()
    thumb.thumbnail((160, 120))
    thumb.save(thumb_buffer, format="JPEG", quality=90)
    thumb_bytes = thumb_buffer.getvalue()

    datetime_value = ascii_value(CAPTURE_TIME)
    make_value = ascii_value("Reconyx")
    model_value = ascii_value("HF2X")
    latitude = rationals((52, 1), (1, 1), (30, 1))
    longitude = rationals((5, 1), (30, 1), (15, 1))

    # Walk the layout once, so every offset below is derived, not hardcoded
    ifd0_offset = 8
    ifd0_end = ifd0_offset + 2 + 5 * 12 + 4
    datetime_offset = ifd0_end
    make_offset = datetime_offset + len(datetime_value)
    model_offset = make_offset + len(make_value)
    exif_ifd_offset = model_offset + len(model_value)
    exif_ifd_end = exif_ifd_offset + 2 + 1 * 12 + 4
    datetime_original_offset = exif_ifd_end
    gps_ifd_offset = datetime_original_offset + len(datetime_value)
    gps_ifd_end = gps_ifd_offset + 2 + 4 * 12 + 4
    latitude_offset = gps_ifd_end
    longitude_offset = latitude_offset + len(latitude)
    ifd1_offset = longitude_offset + len(longitude)
    thumb_offset = ifd1_offset + 2 + 2 * 12 + 4

    ifd0 = struct.pack(">H", 5)
    ifd0 += entry(TAG_MAKE, TYPE_ASCII, len(make_value), struct.pack(">I", make_offset))
    ifd0 += entry(TAG_MODEL, TYPE_ASCII, len(model_value), struct.pack(">I", model_offset))
    ifd0 += entry(TAG_DATETIME, TYPE_ASCII, len(datetime_value), struct.pack(">I", datetime_offset))
    ifd0 += entry(TAG_EXIF_IFD, TYPE_LONG, 1, struct.pack(">I", exif_ifd_offset))
    ifd0 += entry(TAG_GPS_IFD, TYPE_LONG, 1, struct.pack(">I", gps_ifd_offset))
    ifd0 += struct.pack(">I", ifd1_offset)

    exif_ifd = struct.pack(">H", 1)
    exif_ifd += entry(
        TAG_DATETIME_ORIGINAL, TYPE_ASCII, len(datetime_value),
        struct.pack(">I", datetime_original_offset),
    )
    exif_ifd += struct.pack(">I", 0)

    gps_ifd = struct.pack(">H", 4)
    gps_ifd += entry(1, TYPE_ASCII, 2, b"N\x00\x00\x00")           # latitude ref
    gps_ifd += entry(2, TYPE_RATIONAL, 3, struct.pack(">I", latitude_offset))
    gps_ifd += entry(3, TYPE_ASCII, 2, b"E\x00\x00\x00")           # longitude ref
    gps_ifd += entry(4, TYPE_RATIONAL, 3, struct.pack(">I", longitude_offset))
    gps_ifd += struct.pack(">I", 0)

    ifd1 = struct.pack(">H", 2)
    ifd1 += entry(0x0201, TYPE_LONG, 1, struct.pack(">I", thumb_offset))
    ifd1 += entry(0x0202, TYPE_LONG, 1, struct.pack(">I", len(thumb_bytes)))
    ifd1 += struct.pack(">I", 0)

    tiff = (
        b"MM\x00\x2a" + struct.pack(">I", ifd0_offset)
        + ifd0 + datetime_value + make_value + model_value
        + exif_ifd + datetime_value
        + gps_ifd + latitude + longitude
        + ifd1 + thumb_bytes
    )
    return b"Exif\x00\x00" + tiff


def _camera_original() -> bytes:
    """A JPEG shaped like a camera trap original, EXIF thumbnail included."""
    img = _frame()
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=95, exif=_exif_with_thumbnail(img))
    return buffer.getvalue()


def _subject_region() -> dict:
    """A bbox in the shape the Detection rows store, covering the bright block."""
    x1, y1, x2, y2 = SUBJECT_BOX
    return {
        "normalized": [x1 / 1200, y1 / 900, (x2 - x1) / 1200, (y2 - y1) / 900],
        "x_min": x1,
        "y_min": y1,
        "width": x2 - x1,
        "height": y2 - y1,
    }


def _embedded_thumbnail(data: bytes) -> PILImage.Image | None:
    """The thumbnail inside a JPEG's EXIF block, if it carries one."""
    blob = PILImage.open(io.BytesIO(data)).info.get("exif", b"")
    start = blob.find(b"\xff\xd8\xff")
    if start == -1:
        return None
    return PILImage.open(io.BytesIO(blob[start:]))


def _colourfulness(pixel) -> int:
    """Spread between the colour channels. High for the yellow subject."""
    return max(pixel) - min(pixel)


# Well inside the subject box, away from the edges the blur bleeds across
INSIDE_SUBJECT = (150, 150, 350, 450)


class TestTheSubjectIsActuallyGone:
    def test_the_fixture_has_detail_to_lose(self):
        # Otherwise the test below proves nothing about the blur
        assert _detail(_frame(), INSIDE_SUBJECT) > 50

    def test_per_box_blur_destroys_the_subject(self):
        blurred = apply_privacy_blur(_camera_original(), [_subject_region()])
        img = PILImage.open(io.BytesIO(blurred))

        assert _detail(img, INSIDE_SUBJECT) < 10

    def test_the_rest_of_the_frame_is_untouched(self):
        # A blurred person must not cost the ecologist the animal next to it
        blurred = apply_privacy_blur(_camera_original(), [_subject_region()])
        img = PILImage.open(io.BytesIO(blurred))

        far_corner = img.getpixel((1100, 800))
        assert abs(far_corner[1] - BACKGROUND[1]) < 20

    def test_an_image_with_nothing_to_blur_is_byte_identical(self):
        # The reason this download is still worth having. Most camera trap
        # frames hold no person at all, and those must come out as the true
        # original, not a re-encode.
        original = _camera_original()

        assert apply_privacy_blur(original, []) is original


class TestExifSurvivesTheBlur:
    """Capture time and GPS are the whole point of downloading images. A blur
    that strips them turns the zip into a pile of undated JPEGs."""

    def _blurred(self) -> PILImage.Image:
        return PILImage.open(
            io.BytesIO(apply_privacy_blur(_camera_original(), [_subject_region()]))
        )

    def test_the_fixture_carries_the_fields_in_the_first_place(self):
        # Without this, every assertion below would pass just as happily on a
        # fixture that never had a capture time or a position. That is exactly
        # what happened on the pinned Pillow before the fixture was hand-built.
        exif = PILImage.open(io.BytesIO(_camera_original())).getexif()

        assert exif.get(TAG_DATETIME) == CAPTURE_TIME
        assert exif.get_ifd(TAG_EXIF_IFD).get(TAG_DATETIME_ORIGINAL) == CAPTURE_TIME
        assert sorted(exif.get_ifd(TAG_GPS_IFD).keys()) == [1, 2, 3, 4]

    def test_capture_time_survives(self):
        exif = self._blurred().getexif()

        assert exif.get(TAG_DATETIME) == CAPTURE_TIME
        assert exif.get_ifd(TAG_EXIF_IFD).get(TAG_DATETIME_ORIGINAL) == CAPTURE_TIME

    def test_gps_survives(self):
        gps = self._blurred().getexif().get_ifd(TAG_GPS_IFD)

        assert gps.get(1) == "N"
        assert gps.get(2) == (52.0, 1.0, 30.0)
        assert gps.get(3) == "E"

    def test_camera_model_survives(self):
        exif = self._blurred().getexif()

        assert exif.get(TAG_MAKE) == "Reconyx"
        assert exif.get(TAG_MODEL) == "HF2X"

    def test_whole_frame_blur_keeps_it_too(self):
        exif = PILImage.open(
            io.BytesIO(blur_whole_image(_camera_original()))
        ).getexif()

        assert exif.get(TAG_DATETIME) == CAPTURE_TIME
        assert exif.get_ifd(TAG_GPS_IFD).get(1) == "N"


class TestTheEmbeddedThumbnailDoesNotLeak:
    """The trap this fix had to avoid. A camera writes a small copy of the
    frame into the EXIF block itself. Copying the block verbatim carries that
    unblurred copy across, so the file looks blurred while still holding a
    readable picture of the person."""

    def test_the_fixture_really_carries_one(self):
        # Otherwise the two tests below prove nothing
        thumb = _embedded_thumbnail(_camera_original())

        assert thumb is not None
        assert thumb.size == (160, 120)
        # And it really shows the subject, which is what makes it a leak
        assert _colourfulness(thumb.getpixel((30, 40))) > 100

    def test_per_box_blur_drops_it(self):
        blurred = apply_privacy_blur(_camera_original(), [_subject_region()])

        assert _embedded_thumbnail(blurred) is None

    def test_whole_frame_blur_drops_it(self):
        assert _embedded_thumbnail(blur_whole_image(_camera_original())) is None

    def test_the_helper_never_copies_the_raw_block(self):
        # The raw block is exactly what holds the thumbnail. Rebuilding from
        # the parsed tags is the thing that drops it, so it is not free to be
        # "simplified" back to the raw block later. Body only, the docstring
        # names the thing it is warning against.
        body = inspect.getsource(_carried_exif).split('"""')[-1]

        assert "exif.tobytes()" in body
        assert "info[" not in body
        assert "info.get(" not in body


class TestCarriedExif:
    def test_an_image_without_exif_does_not_crash_the_save(self):
        # Pillow raises TypeError on exif=None, so the helper must return
        # empty bytes rather than None
        plain = PILImage.new("RGB", (64, 48), BACKGROUND)
        buffer = io.BytesIO()
        plain.save(buffer, format="JPEG", quality=95)

        assert _carried_exif(PILImage.open(io.BytesIO(buffer.getvalue()))) == b""

        blurred = apply_privacy_blur(
            buffer.getvalue(),
            [{"normalized": [0.1, 0.1, 0.5, 0.5]}],
        )
        assert PILImage.open(io.BytesIO(blurred)).size == (64, 48)

    def test_greyscale_night_shot_keeps_its_exif(self):
        # Camera traps send night shots in mode L, which the blur converts to
        # RGB. The EXIF is read before that conversion, so it must survive.
        grey = PILImage.new("L", (800, 600), 128)
        buffer = io.BytesIO()
        grey.save(buffer, format="JPEG", quality=95, exif=_exif_with_thumbnail(grey))

        blurred = apply_privacy_blur(
            buffer.getvalue(), [{"normalized": [0.1, 0.1, 0.3, 0.3]}]
        )
        out = PILImage.open(io.BytesIO(blurred))

        assert out.mode == "RGB"
        assert out.getexif().get(TAG_DATETIME) == CAPTURE_TIME


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    """Returns fixed Detection rows and records the query it was asked for."""

    def __init__(self, rows):
        self._rows = rows
        self.queries = []

    async def execute(self, query, params=None):
        self.queries.append(query)
        return _FakeResult(self._rows)


class TestBlurRegionsForImages:
    """One query for a whole selection, so a 500-image zip does not ask the
    same question 500 times."""

    def _detection(self, image_id: int, category: str = "person") -> Detection:
        return Detection(
            image_id=image_id,
            category=category,
            confidence=0.9,
            bbox={"normalized": [0.1, 0.1, 0.2, 0.2]},
        )

    @pytest.mark.asyncio
    async def test_regions_are_grouped_per_image(self):
        from routers.images import blur_regions_for_images

        db = _FakeSession([
            self._detection(1),
            self._detection(1),
            self._detection(3),
        ])
        out = await blur_regions_for_images(db, [1, 2, 3], Project(name="p", blur_people=True, blur_vehicles=True, detection_threshold=0.5))

        assert len(out[1]) == 2
        assert len(out[3]) == 1
        assert 2 not in out  # nothing to blur, so absent rather than empty

    @pytest.mark.asyncio
    async def test_a_project_that_blurs_nothing_asks_no_query(self):
        from routers.images import blur_regions_for_images

        db = _FakeSession([self._detection(1)])
        project = Project(name="p", blur_people=False, blur_vehicles=False)
        out = await blur_regions_for_images(db, [1], project)

        assert out == {}
        assert db.queries == []

    @pytest.mark.asyncio
    async def test_an_empty_selection_asks_no_query(self):
        from routers.images import blur_regions_for_images

        db = _FakeSession([])
        out = await blur_regions_for_images(db, [], Project(name="p", blur_people=True, blur_vehicles=True, detection_threshold=0.5))

        assert out == {}
        assert db.queries == []

    @pytest.mark.asyncio
    async def test_one_query_for_the_whole_batch(self):
        from routers.images import blur_regions_for_images

        db = _FakeSession([self._detection(i) for i in range(1, 101)])
        await blur_regions_for_images(db, list(range(1, 101)), Project(name="p", blur_people=True, blur_vehicles=True, detection_threshold=0.5))

        assert len(db.queries) == 1

    @pytest.mark.asyncio
    async def test_the_single_image_helper_uses_the_same_query(self):
        # Two copies of "which detections does this project hide" is exactly
        # how the serve path and an export drift apart
        from routers.images import _get_blur_regions

        src = inspect.getsource(_get_blur_regions)
        assert "blur_regions_for_images" in src
        assert "select(" not in src


class TestDownloadEndpoint:
    def _source(self):
        from routers.image_admin import bulk_download_images

        return inspect.getsource(bulk_download_images)

    def test_the_zip_is_blurred(self):
        src = self._source()

        assert "apply_privacy_blur" in src
        assert "blur_regions_for_images" in src

    def test_it_applies_the_same_full_blur_rule_as_every_serve_path(self):
        # Belt and braces. Classified images have detections, so this branch
        # should not fire, but if the status filter ever changes the download
        # must fail closed like the rest of the app.
        src = self._source()

        assert "needs_full_blur" in src
        assert "blur_whole_image" in src

    def test_there_is_no_bulk_reveal(self):
        # The whole point of the fix. A bulk unblur would side-step the
        # per-image audit trail, which is what was wrong with the old
        # behaviour in the first place. An admin reveals one image at a time,
        # in the detail view, and each one is logged.
        from routers.image_admin import bulk_download_images

        assert "unblurred" not in inspect.signature(bulk_download_images).parameters

        from routers.image_admin import BulkImageActionRequest

        assert "unblurred" not in BulkImageActionRequest.model_fields

    def test_only_classified_images_are_downloadable(self):
        # An image the detector has not seen has no detection rows, so the
        # blur could not be placed on it
        src = self._source()

        assert "classified_only=True" in src

    def test_the_project_is_loaded_before_the_zip_is_built(self):
        # The blur cannot be decided without the project's toggles, so a
        # missing project must stop the download, not skip the blur
        src = self._source()

        assert 'raise HTTPException(status_code=404, detail="Project not found")' in src

    def test_admin_only(self):
        src = self._source()

        assert "can_admin_project(current_user, project_id, db)" in src
        assert "Project admin access required" in src

    def test_a_file_that_cannot_be_blurred_is_left_out(self):
        # Never the third option of writing it in unblurred. The handler must
        # skip, not fall through to the zf.writestr below it.
        src = self._source()
        handler = src.split("Skipping image that could not be blurred", 1)[1]
        before_write = handler.split("zf.writestr", 1)[0]

        assert "continue" in before_write
        assert "skipped += 1" in before_write


class TestOtherBulkActionsAreUnaffected:
    """Hide, unhide and delete must keep working on a pending or failed image.
    That is how a stuck import gets cleaned up, and pinning classified for all
    of them would have broken it silently."""

    def test_classified_only_is_off_by_default(self):
        from routers.image_admin import _resolve_target_image_ids

        signature = inspect.signature(_resolve_target_image_ids)
        assert signature.parameters["classified_only"].default is False

    @pytest.mark.parametrize(
        "func_name", ["bulk_hide_images", "bulk_unhide_images", "bulk_delete_images"]
    )
    def test_they_do_not_pin_classified(self, func_name):
        from routers import image_admin

        src = inspect.getsource(getattr(image_admin, func_name))
        assert "classified_only" not in src


class TestNeedsFullBlurStillHolds:
    """The download imports the shared rule rather than restating it."""

    def test_a_classified_image_takes_the_per_box_path(self):
        from routers.images import needs_full_blur

        image = Image(uuid="u", filename="a.jpg", status="classified")
        assert needs_full_blur(image, Project(name="p", blur_people=True, blur_vehicles=True, detection_threshold=0.5)) is False

    def test_a_pending_image_would_be_blurred_whole(self):
        from routers.images import needs_full_blur

        image = Image(uuid="u", filename="a.jpg", status="pending")
        assert needs_full_blur(image, Project(name="p", blur_people=True, blur_vehicles=True, detection_threshold=0.5)) is True
