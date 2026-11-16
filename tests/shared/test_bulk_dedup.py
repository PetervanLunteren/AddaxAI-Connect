"""The rule that decides which bulk files are already in the project."""
from datetime import datetime

from shared.bulk_dedup import files_already_present, safe_basename

T1 = datetime(2026, 5, 12, 10, 15, 20)
T2 = datetime(2026, 5, 12, 10, 46, 43)


def _skipped(files, existing):
    return [files[i][0] for i in files_already_present(files, existing)]


class TestFilesAlreadyPresent:
    def test_nothing_in_the_project(self):
        assert _skipped([("SYWE0001.JPG", T1)], []) == []

    def test_empty_folder(self):
        assert files_already_present([], [("E1000001.JPG", T1)]) == []

    def test_single_photo_with_4g_copy(self):
        # Non-burst camera: one SD file, one 4G image with another name.
        assert _skipped([("SYWE0001.JPG", T1)], [("E1000001.JPG", T1)]) == ["SYWE0001.JPG"]

    def test_burst_against_one_4g_copy(self):
        # pwn ZO: three frames in one second, the camera sent the first.
        files = [("SYWE2742.JPG", T1), ("SYWE2740.JPG", T1), ("SYWE2741.JPG", T1)]
        assert _skipped(files, [("E1002740.JPG", T1)]) == ["SYWE2740.JPG"]

    def test_full_reupload_skips_everything(self):
        files = [("SYWE2740.JPG", T1), ("SYWE2741.JPG", T1), ("SYWE2742.JPG", T2)]
        existing = [("E1002740.JPG", T1), ("SYWE2740.JPG", T1), ("SYWE2741.JPG", T1), ("SYWE2742.JPG", T2)]
        # Name matches first, then the left-over 4G image takes nothing more.
        assert sorted(_skipped(files, existing)) == ["SYWE2740.JPG", "SYWE2741.JPG", "SYWE2742.JPG"]

    def test_missing_burst_frame_is_uploaded(self):
        # The project holds the 4G copy of frame 2740 and the SD frame 2742;
        # frame 2741 is missing. SYWE2742 matches by name, the 4G copy
        # takes the first remaining file (2740, the same shot), and 2741 is
        # uploaded. Without the name step the 4G copy could take 2741.
        files = [("SYWE2740.JPG", T1), ("SYWE2741.JPG", T1), ("SYWE2742.JPG", T1)]
        existing = [("E1002740.JPG", T1), ("SYWE2742.JPG", T1)]
        assert sorted(_skipped(files, existing)) == ["SYWE2740.JPG", "SYWE2742.JPG"]

    def test_more_existing_than_files(self):
        files = [("SYWE0001.JPG", T1)]
        existing = [("E1000001.JPG", T1), ("E1000002.JPG", T1), ("X.JPG", T1)]
        assert _skipped(files, existing) == ["SYWE0001.JPG"]

    def test_other_seconds_do_not_count(self):
        assert _skipped([("SYWE0001.JPG", T1)], [("E1000001.JPG", T2)]) == []

    def test_names_compare_after_cleaning(self):
        # Bulk images are stored under the cleaned name.
        files = [("100SYCAM/SYWE0004 (2).JPG", T1)]
        assert _skipped(files, [("SYWE0004_2_.JPG", T1)]) == ["100SYCAM/SYWE0004 (2).JPG"]

    def test_indexes_come_back_sorted(self):
        files = [("C.JPG", T1), ("A.JPG", T2), ("B.JPG", T1)]
        assert files_already_present(files, [("A.JPG", T2), ("Z.JPG", T1)]) == [1, 2]


class TestSafeBasename:
    # The single cases live in tests/api/test_bulk_upload_helpers.py.
    def test_twice_gives_the_same_result(self):
        # Stored bulk names are already cleaned and get cleaned again when
        # compared, so cleaning must not change a cleaned name.
        for name in ["SYWE0004 (2).JPG", "___name___.jpg", "éphoto.jpg", "a   b.jpg"]:
            assert safe_basename(safe_basename(name)) == safe_basename(name)
