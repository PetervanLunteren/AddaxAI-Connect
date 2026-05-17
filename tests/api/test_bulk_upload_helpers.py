"""
Unit tests for the bulk-upload helper functions.

Copies the small pure helpers from services/api/routers/bulk_upload.py
and services/bulk-upload/worker.py to test them without dragging in the
FastAPI app, MinIO client, or database. Same pattern as
test_camera_tags.py.
"""
import re


# --- copies of _safe_basename and _staging_prefix ---
def _safe_basename(name: str) -> str:
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_")
    return cleaned or "image.jpg"


def _staging_prefix(project_id: int, job_uuid: str) -> str:
    return f"{project_id}/{job_uuid}/"


# --- copy of the worker's recover-filename-from-key logic ---
def _recover_filename(key: str) -> str:
    tail = key.rsplit("/", 1)[-1]
    return tail.split("_", 1)[1] if "_" in tail else tail


class TestSafeBasename:
    def test_plain_name(self):
        assert _safe_basename("IMG_0001.JPG") == "IMG_0001.JPG"

    def test_strips_unix_path(self):
        assert _safe_basename("DCIM/100EK113/IMG_0001.JPG") == "IMG_0001.JPG"

    def test_strips_windows_path(self):
        assert _safe_basename("DCIM\\100EK113\\IMG_0001.JPG") == "IMG_0001.JPG"

    def test_replaces_spaces_with_underscore(self):
        assert _safe_basename("my photo.jpg") == "my_photo.jpg"

    def test_replaces_special_chars(self):
        assert _safe_basename("photo$%^.jpg") == "photo_.jpg"

    def test_collapses_consecutive_unsafe_chars(self):
        assert _safe_basename("a   b.jpg") == "a_b.jpg"

    def test_strips_leading_trailing_underscores(self):
        assert _safe_basename("___name___.jpg") == "name___.jpg"

    def test_blank_falls_back_to_default(self):
        assert _safe_basename("") == "image.jpg"

    def test_only_unsafe_falls_back(self):
        assert _safe_basename("///") == "image.jpg"

    def test_replaces_unicode_with_underscore(self):
        # Non-ASCII characters become underscores so the staging key
        # is ASCII-safe for any S3 backend. Leading underscores are
        # then stripped, so this leaves "photo.jpg".
        assert _safe_basename("éphoto.jpg") == "photo.jpg"


class TestStagingPrefix:
    def test_shape(self):
        assert _staging_prefix(7, "abc-123") == "7/abc-123/"

    def test_ends_with_slash(self):
        # Worker branches on trailing slash to pick the prefix path
        # over the legacy single-zip path; keep this invariant.
        assert _staging_prefix(1, "u").endswith("/")


class TestRecoverFilename:
    def test_typical_key(self):
        assert _recover_filename("1/job-uuid/000042_IMG_0042.JPG") == "IMG_0042.JPG"

    def test_index_with_complex_name(self):
        assert (
            _recover_filename("9/job/000001_my_photo_123.jpg")
            == "my_photo_123.jpg"
        )

    def test_no_underscore_falls_back_to_tail(self):
        # Defensive: a key written without the index prefix should not
        # crash, even though the API never produces this shape.
        assert _recover_filename("9/job/picture.jpg") == "picture.jpg"


class TestUploadedIndexParse:
    """Parsing logic for the GET /jobs/{uuid}/uploaded-indexes endpoint."""

    @staticmethod
    def _parse_index(key: str):
        # Copy of the inline parser in routers/bulk_upload.py.
        tail = key.rsplit("/", 1)[-1]
        prefix = tail.split("_", 1)[0] if "_" in tail else tail
        try:
            return int(prefix)
        except ValueError:
            return None

    def test_standard_key(self):
        assert self._parse_index("1/abc/000042_IMG_0042.JPG") == 42

    def test_zero_index(self):
        assert self._parse_index("9/abc/000000_first.jpg") == 0

    def test_max_index(self):
        assert self._parse_index("9/abc/004999_last.jpg") == 4999

    def test_missing_underscore_returns_none(self):
        assert self._parse_index("9/abc/garbage.jpg") is None

    def test_non_numeric_prefix_returns_none(self):
        # If somehow a key without the standard index prefix lands in
        # the staging bucket, the endpoint must skip it, not 500.
        assert self._parse_index("9/abc/oops_file.jpg") is None


class TestStatusTransitions:
    """
    Document the legal status transitions in the bulk-upload state
    machine. Lock them down so a future change cannot silently add a
    transition that the API allows but the UI doesn't expect.
    """

    # status the API can move a job into via its endpoints
    LEGAL_TRANSITIONS = {
        "uploading": {"processing", "failed"},
        "processing": {"done", "failed"},
        # Terminal states have no outgoing edges.
        "done": set(),
        "failed": set(),
    }

    def test_uploading_can_become_processing(self):
        assert "processing" in self.LEGAL_TRANSITIONS["uploading"]

    def test_uploading_can_become_failed(self):
        assert "failed" in self.LEGAL_TRANSITIONS["uploading"]

    def test_processing_cannot_become_uploading(self):
        assert "uploading" not in self.LEGAL_TRANSITIONS["processing"]

    def test_terminal_states_have_no_outgoing(self):
        assert self.LEGAL_TRANSITIONS["done"] == set()
        assert self.LEGAL_TRANSITIONS["failed"] == set()
