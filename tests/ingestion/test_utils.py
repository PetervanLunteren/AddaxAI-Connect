"""Tests for ingestion utility helpers (reject_file, prune_empty_parents)."""
import json
import os
from pathlib import Path

import pytest

import utils
from utils import (
    delete_file,
    is_valid_gps,
    prune_empty_parents,
    reject_file,
)


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    """
    Make ``utils._upload_root`` resolve to a real tmp directory so file
    operations are isolated per test. Patches the underlying settings
    object that the helper consults.
    """
    monkeypatch.setattr(utils.settings, "ftps_upload_dir", str(tmp_path))
    return tmp_path


class TestIsValidGps:
    def test_real_coord(self):
        assert is_valid_gps((52.02368, 12.98290))

    def test_negative_coord(self):
        assert is_valid_gps((-33.85679, -70.65876))

    def test_null_island_rejected(self):
        assert not is_valid_gps((0.0, 0.0))

    def test_none_rejected(self):
        assert not is_valid_gps(None)

    def test_out_of_range_lat_rejected(self):
        assert not is_valid_gps((91.0, 12.0))

    def test_out_of_range_lon_rejected(self):
        assert not is_valid_gps((52.0, 181.0))


class TestRejectFileFlat:
    def test_flat_source_keeps_original_basename(self, upload_root):
        src = upload_root / "IMG_0001.jpg"
        src.write_bytes(b"\xff\xd8\xff\x00")

        reject_file(str(src), "missing_datetime", "no timestamp")

        rejected = upload_root / "rejected" / "missing_datetime" / "IMG_0001.jpg"
        assert rejected.exists()
        assert not src.exists()

        error_json = upload_root / "rejected" / "missing_datetime" / "IMG_0001.jpg.error.json"
        assert error_json.exists()
        data = json.loads(error_json.read_text())
        assert data["filename"] == "IMG_0001.jpg"
        assert data["reason"] == "missing_datetime"
        assert data["details"] == "no timestamp"


class TestRejectFileNested:
    def _setup_instar_tree(self, upload_root, filename="Test-Snapshot.jpeg"):
        nested = upload_root / "INSTAR" / "lat52.02368_lon12.98290"
        nested.mkdir(parents=True)
        src = nested / filename
        src.write_bytes(b"\xff\xd8\xff\x00")
        return src

    def test_nested_source_gets_path_prefixed_filename(self, upload_root):
        src = self._setup_instar_tree(upload_root)

        reject_file(str(src), "missing_datetime", "no timestamp")

        expected = upload_root / "rejected" / "missing_datetime" / (
            "INSTAR_lat52.02368_lon12.98290_Test-Snapshot.jpeg"
        )
        assert expected.exists()
        assert not src.exists()

        error_json = expected.with_suffix(expected.suffix + ".error.json")
        assert error_json.exists()
        data = json.loads(error_json.read_text())
        assert data["filename"] == "Test-Snapshot.jpeg"
        assert data["source_path"] == str(src)

    def test_two_nested_sources_with_same_basename_do_not_collide(self, upload_root):
        # Two different INSTAR cameras both produce a Test-Snapshot.jpeg
        src_a = upload_root / "INSTAR" / "lat52.02368_lon12.98290" / "Test-Snapshot.jpeg"
        src_b = upload_root / "INSTAR" / "lat-33.85679_lon-70.65876" / "Test-Snapshot.jpeg"
        for src in (src_a, src_b):
            src.parent.mkdir(parents=True)
            src.write_bytes(b"\xff\xd8\xff\x00")

        reject_file(str(src_a), "missing_datetime", "a")
        reject_file(str(src_b), "missing_datetime", "b")

        rejected_dir = upload_root / "rejected" / "missing_datetime"
        rejected_files = sorted(p.name for p in rejected_dir.iterdir() if not p.name.endswith(".error.json"))
        assert rejected_files == [
            "INSTAR_lat-33.85679_lon-70.65876_Test-Snapshot.jpeg",
            "INSTAR_lat52.02368_lon12.98290_Test-Snapshot.jpeg",
        ]

    def test_nested_reject_prunes_empty_parents(self, upload_root):
        src = self._setup_instar_tree(upload_root)
        instar_root = upload_root / "INSTAR"

        reject_file(str(src), "missing_datetime", "no timestamp")

        # All empty parents up to (but not including) the upload root are gone
        assert not instar_root.exists()
        # Upload root and rejected/ are intact
        assert upload_root.exists()
        assert (upload_root / "rejected" / "missing_datetime").exists()


class TestDeleteFile:
    def test_delete_flat_file(self, upload_root):
        src = upload_root / "A.jpg"
        src.write_bytes(b"\x00")

        delete_file(str(src))

        assert not src.exists()
        # Upload root must not be removed
        assert upload_root.exists()

    def test_delete_nested_prunes_parents(self, upload_root):
        nested_dir = upload_root / "INSTAR" / "lat52.02368_lon12.98290"
        nested_dir.mkdir(parents=True)
        src = nested_dir / "A_2026-04-09_16-04-05.jpeg"
        src.write_bytes(b"\x00")

        delete_file(str(src))

        assert not (upload_root / "INSTAR").exists()
        assert upload_root.exists()


class TestPruneEmptyParents:
    def test_walks_up_until_non_empty(self, upload_root):
        # /upload_root/a/b/c/file.jpg with a sibling at /upload_root/a/sibling.jpg
        deep = upload_root / "a" / "b" / "c"
        deep.mkdir(parents=True)
        (deep / "file.jpg").write_bytes(b"")
        sibling = upload_root / "a" / "sibling.jpg"
        sibling.write_bytes(b"")

        # Simulate the file having just been deleted
        (deep / "file.jpg").unlink()

        prune_empty_parents(str(deep / "file.jpg"))

        # /upload_root/a/b and /upload_root/a/b/c are gone
        assert not (upload_root / "a" / "b").exists()
        # /upload_root/a survives because of the sibling
        assert (upload_root / "a").exists()
        assert sibling.exists()

    def test_stops_at_upload_root(self, upload_root):
        src = upload_root / "lonely.jpg"
        src.write_bytes(b"")
        src.unlink()

        prune_empty_parents(str(src))

        # The upload root itself is never removed
        assert upload_root.exists()

    def test_does_not_touch_rejected_tree(self, upload_root):
        rejected_dir = upload_root / "rejected" / "missing_datetime"
        rejected_dir.mkdir(parents=True)
        leftover = rejected_dir / "ghost.jpg"

        # Even with a deleted file path inside rejected/, the tree must survive
        prune_empty_parents(str(leftover))

        assert rejected_dir.exists()
        assert (upload_root / "rejected").exists()

    def test_swallows_errors_for_paths_outside_upload_root(self, upload_root, tmp_path_factory):
        # An isolated tmp tree that is NOT under the configured upload root
        elsewhere_root = tmp_path_factory.mktemp("not_uploads")
        elsewhere_dir = elsewhere_root / "subdir"
        elsewhere_dir.mkdir()
        outside = elsewhere_dir / "file.jpg"
        outside.write_bytes(b"")
        outside.unlink()

        # Must not raise; nothing under elsewhere_root or upload_root should change
        prune_empty_parents(str(outside))

        assert elsewhere_dir.exists()  # untouched - prune ignored it
        assert upload_root.exists()
