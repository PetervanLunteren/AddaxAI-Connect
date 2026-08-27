"""Tests for ingestion utility helpers (reject_file, prune_empty_parents)."""
import os
import re
from pathlib import Path

import pytest

import utils
from utils import (
    delete_file,
    is_valid_gps,
    prune_empty_parents,
    reject_file,
)

# Rejected filenames are "<UTC timestamp>_<flattened source path>",
# e.g. 20260806T142530_123456_IMG_0001.jpg
TIMESTAMP_PREFIX_RE = r"\d{8}T\d{6}_\d{6}_"


def rejected_images(reason_dir: Path) -> list[Path]:
    """The rejected image files in a reason directory."""
    return sorted(reason_dir.iterdir())


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
    def test_flat_source_gets_timestamp_prefixed_basename(self, upload_root):
        src = upload_root / "IMG_0001.jpg"
        src.write_bytes(b"\xff\xd8\xff\x00")

        reject_file(str(src), "missing_datetime", "no timestamp")

        reason_dir = upload_root / "rejected" / "missing_datetime"
        (rejected,) = rejected_images(reason_dir)
        assert re.fullmatch(TIMESTAMP_PREFIX_RE + r"IMG_0001\.jpg", rejected.name)
        assert not src.exists()

    def test_moves_only_the_file(self, upload_root):
        # The Rejection row is the record. No sidecar next to the file, so
        # nothing on disk can drift from the row.
        src = upload_root / "IMG_0003.jpg"
        src.write_bytes(b"\xff\xd8\xff\x00")

        reject_file(str(src), "missing_datetime", "no timestamp")

        reason_dir = upload_root / "rejected" / "missing_datetime"
        assert [p.suffix for p in reason_dir.iterdir()] == [".jpg"]

    def test_returns_moved_file_path(self, upload_root):
        # The persistence layer stores this path on the Rejection row, so the
        # return value must point at the moved file.
        src = upload_root / "IMG_0002.jpg"
        src.write_bytes(b"\xff\xd8\xff\x00")

        dest = reject_file(str(src), "missing_gps", "no gps")

        (rejected,) = rejected_images(upload_root / "rejected" / "missing_gps")
        assert dest == str(rejected)
        assert rejected.name.endswith("_IMG_0002.jpg")

    def test_same_basename_rejected_twice_does_not_overwrite(self, upload_root):
        # The TODO scenario: many cameras all send an img001.jpg with bad GPS.
        # Every rejection must survive as its own file.
        for details in ("first camera", "second camera"):
            src = upload_root / "img001.jpg"
            src.write_bytes(b"\xff\xd8\xff\x00")
            reject_file(str(src), "invalid_gps", details)

        reason_dir = upload_root / "rejected" / "invalid_gps"
        rejected = rejected_images(reason_dir)
        assert len(rejected) == 2
        assert all(p.name.endswith("_img001.jpg") for p in rejected)
        assert all(p.read_bytes() == b"\xff\xd8\xff\x00" for p in rejected)


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

        (rejected,) = rejected_images(upload_root / "rejected" / "missing_datetime")
        assert re.fullmatch(
            TIMESTAMP_PREFIX_RE + r"INSTAR_lat52\.02368_lon12\.98290_Test-Snapshot\.jpeg",
            rejected.name,
        )
        assert not src.exists()

    def test_two_nested_sources_with_same_basename_do_not_collide(self, upload_root):
        # Two different INSTAR cameras both produce a Test-Snapshot.jpeg
        src_a = upload_root / "INSTAR" / "lat52.02368_lon12.98290" / "Test-Snapshot.jpeg"
        src_b = upload_root / "INSTAR" / "lat-33.85679_lon-70.65876" / "Test-Snapshot.jpeg"
        for src in (src_a, src_b):
            src.parent.mkdir(parents=True)
            src.write_bytes(b"\xff\xd8\xff\x00")

        reject_file(str(src_a), "missing_datetime", "a")
        reject_file(str(src_b), "missing_datetime", "b")

        rejected = rejected_images(upload_root / "rejected" / "missing_datetime")
        names = sorted(p.name for p in rejected)
        assert len(names) == 2
        assert any(n.endswith("_INSTAR_lat-33.85679_lon-70.65876_Test-Snapshot.jpeg") for n in names)
        assert any(n.endswith("_INSTAR_lat52.02368_lon12.98290_Test-Snapshot.jpeg") for n in names)

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
