"""Tests for notifications-telegram image_handler storage path parsing.

The download_image_from_minio() function itself calls MinIO, but its path
parsing logic is worth testing. We reproduce the parsing logic inline.
"""


VALID_BUCKETS = ["raw-images", "crops", "thumbnails", "models", "project-images"]


def parse_storage_path(storage_path: str):
    """Reproduce the path parsing from image_handler.download_image_from_minio."""
    parts = storage_path.split("/", 1)
    if len(parts) == 2 and parts[0] in VALID_BUCKETS:
        return parts[0], parts[1]
    else:
        return "thumbnails", storage_path


class TestStoragePathParsing:
    def test_path_with_known_bucket(self):
        bucket, key = parse_storage_path("thumbnails/12345/image.jpg")
        assert bucket == "thumbnails"
        assert key == "12345/image.jpg"

    def test_path_with_raw_images_bucket(self):
        bucket, key = parse_storage_path("raw-images/abc/photo.jpg")
        assert bucket == "raw-images"
        assert key == "abc/photo.jpg"

    def test_path_without_bucket_defaults_to_thumbnails(self):
        bucket, key = parse_storage_path("12345/image.jpg")
        assert bucket == "thumbnails"
        assert key == "12345/image.jpg"

    def test_bare_filename_defaults_to_thumbnails(self):
        bucket, key = parse_storage_path("image.jpg")
        assert bucket == "thumbnails"
        assert key == "image.jpg"

    def test_unknown_bucket_prefix_defaults_to_thumbnails(self):
        bucket, key = parse_storage_path("unknown-bucket/image.jpg")
        assert bucket == "thumbnails"
        assert key == "unknown-bucket/image.jpg"
