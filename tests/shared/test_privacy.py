"""Tests for shared/privacy.py: the removal rule and the placeholder."""
from io import BytesIO
from types import SimpleNamespace

from shared.models import Project
from shared.privacy import (
    FALLBACK_SIZE,
    THUMBNAIL_WIDTH,
    placeholder_jpeg,
    removal_sentence,
    removed_categories,
    replace_with_placeholder,
)
from shared.storage import BUCKET_RAW_IMAGES, BUCKET_THUMBNAILS


def _project(people: bool = False, vehicles: bool = False, threshold: float = 0.5) -> Project:
    return Project(
        name="p",
        delete_people=people,
        delete_vehicles=vehicles,
        detection_threshold=threshold,
    )


def _det(category: str, confidence: float):
    return SimpleNamespace(category=category, confidence=confidence)


class TestRemovedCategories:
    """Same rule as the blur: the project's categories, at or above its threshold."""

    def test_nothing_when_the_project_keeps_everything(self):
        assert removed_categories([_det("person", 0.9)], _project()) == []

    def test_person_at_the_threshold_counts(self):
        assert removed_categories([_det("person", 0.5)], _project(people=True)) == ["person"]

    def test_person_below_the_threshold_is_kept(self):
        assert removed_categories([_det("person", 0.49)], _project(people=True)) == []

    def test_a_category_the_project_keeps_is_ignored(self):
        assert removed_categories([_det("vehicle", 0.9)], _project(people=True)) == []

    def test_both_in_a_fixed_order(self):
        dets = [_det("vehicle", 0.9), _det("person", 0.7), _det("animal", 0.95)]
        assert removed_categories(dets, _project(people=True, vehicles=True)) == ["person", "vehicle"]

    def test_animals_never_count(self):
        assert removed_categories([_det("animal", 0.99)], _project(people=True, vehicles=True)) == []

    def test_no_detections(self):
        assert removed_categories([], _project(people=True, vehicles=True)) == []


class TestRemovalSentence:
    def test_person(self):
        assert removal_sentence(["person"]) == "This photo showed a person and was removed for privacy."

    def test_vehicle(self):
        assert removal_sentence(["vehicle"]) == "This photo showed a vehicle and was removed for privacy."

    def test_both(self):
        assert removal_sentence(["person", "vehicle"]) == (
            "This photo showed a person and a vehicle and was removed for privacy."
        )

    def test_generic_when_nothing_is_named(self):
        assert removal_sentence([]) == "This photo was removed for privacy."


def _decode(data: bytes):
    from PIL import Image

    with Image.open(BytesIO(data)) as img:
        img.load()
        return img.format, img.size


class TestPlaceholderJpeg:
    def test_is_a_jpeg_of_the_requested_size(self):
        data = placeholder_jpeg(640, 480, removal_sentence(["person"]))
        assert _decode(data) == ("JPEG", (640, 480))

    def test_thumbnail_size_renders_too(self):
        data = placeholder_jpeg(THUMBNAIL_WIDTH, 200, removal_sentence(["person", "vehicle"]))
        assert _decode(data) == ("JPEG", (THUMBNAIL_WIDTH, 200))


class FakeStorage:
    """Records the calls in order and keeps the uploaded bytes."""

    def __init__(self):
        self.calls = []

    def delete_object_versions(self, bucket, object_name):
        self.calls.append(("delete_versions", bucket, object_name, None))

    def upload_fileobj(self, file_obj, bucket, object_name):
        self.calls.append(("upload", bucket, object_name, file_obj.getvalue()))


def _image(thumbnail_path="cam/2026/10/x.jpg", metadata=None):
    return SimpleNamespace(
        storage_path="cam/2026/10/x.jpg",
        thumbnail_path=thumbnail_path,
        image_metadata=metadata,
    )


class TestReplaceWithPlaceholder:
    def test_raw_versions_go_first_then_the_placeholder_then_the_thumbnail(self):
        storage = FakeStorage()
        replace_with_placeholder(storage, _image(metadata={"width": 800, "height": 600}), ["person"])

        assert [c[:3] for c in storage.calls] == [
            ("delete_versions", BUCKET_RAW_IMAGES, "cam/2026/10/x.jpg"),
            ("upload", BUCKET_RAW_IMAGES, "cam/2026/10/x.jpg"),
            ("upload", BUCKET_THUMBNAILS, "cam/2026/10/x.jpg"),
        ]
        assert _decode(storage.calls[1][3]) == ("JPEG", (800, 600))
        assert _decode(storage.calls[2][3]) == ("JPEG", (THUMBNAIL_WIDTH, 225))

    def test_no_thumbnail_upload_without_a_thumbnail_path(self):
        storage = FakeStorage()
        replace_with_placeholder(storage, _image(thumbnail_path=None, metadata={"width": 800, "height": 600}), ["person"])
        assert [c[0] for c in storage.calls] == ["delete_versions", "upload"]

    def test_fallback_size_when_the_row_carries_no_dimensions(self):
        storage = FakeStorage()
        replace_with_placeholder(storage, _image(metadata=None), ["vehicle"])
        assert _decode(storage.calls[1][3]) == ("JPEG", FALLBACK_SIZE)
