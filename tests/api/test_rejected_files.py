"""Tests for the rejected files helpers in the ingestion monitoring router.

reprocess_destination decides where a rejected file goes back to. Getting
it wrong either re-rejects every path-based (INSTAR) file or, worse, writes
outside the upload tree.
"""
import os
import sys

_api = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "services", "api"))
if _api not in sys.path:
    sys.path.insert(0, _api)

from routers.ingestion_monitoring import reprocess_destination  # noqa: E402


def test_restores_original_relative_path(tmp_path):
    # The INSTAR case: the profile reads lat/lon from the directory, so the
    # file must go back on exactly that path to be identified again.
    dest = reprocess_destination(
        tmp_path,
        "INSTAR/lat52.02368_lon12.98290/20260409/images/A.jpeg",
        str(tmp_path / "rejected" / "missing_datetime" / "20260806T142530_123456_INSTAR_A.jpeg"),
    )
    assert dest == (tmp_path / "INSTAR/lat52.02368_lon12.98290/20260409/images/A.jpeg").resolve()


def test_flat_upload_goes_back_to_root(tmp_path):
    dest = reprocess_destination(
        tmp_path, "IMG_0001.JPG", str(tmp_path / "rejected" / "missing_gps" / "x_IMG_0001.JPG")
    )
    assert dest == (tmp_path / "IMG_0001.JPG").resolve()


def test_row_without_source_path_falls_back_to_current_name(tmp_path):
    # Rows from before source_path existed. The behaviour reprocess always had.
    disk = tmp_path / "rejected" / "missing_gps" / "20260806T142530_123456_IMG_0001.JPG"
    dest = reprocess_destination(tmp_path, None, str(disk))
    assert dest == (tmp_path.resolve() / "20260806T142530_123456_IMG_0001.JPG")


def test_source_path_escaping_the_root_is_ignored(tmp_path):
    disk = tmp_path / "rejected" / "missing_gps" / "evil.jpg"
    dest = reprocess_destination(tmp_path, "../../etc/evil.jpg", str(disk))
    assert dest == (tmp_path.resolve() / "evil.jpg")
    assert tmp_path.resolve() in dest.parents


def test_absolute_source_path_is_ignored(tmp_path):
    # An absolute path joined onto the root replaces it. Must not be honoured.
    disk = tmp_path / "rejected" / "missing_gps" / "evil.jpg"
    dest = reprocess_destination(tmp_path, "/etc/evil.jpg", str(disk))
    assert dest == (tmp_path.resolve() / "evil.jpg")
