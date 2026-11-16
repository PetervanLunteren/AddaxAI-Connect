"""The selection in scripts/remove_live_twins.py, without a database."""
import importlib.util
import os
from datetime import datetime

_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "remove_live_twins.py")
_spec = importlib.util.spec_from_file_location("remove_live_twins", _PATH)
remove_live_twins = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(remove_live_twins)
pick_twins = remove_live_twins.pick_twins

T1 = datetime(2026, 5, 12, 10, 15, 20)
T2 = datetime(2026, 5, 12, 10, 46, 43)


class TestPickTwins:
    def test_burst_loses_the_copy_of_the_4g_photo(self):
        # pwn ZO, 12 May 10:15:20: 4G sent E1002740, the SD card had three frames.
        bulk = [(11, "SYWE2740.JPG", T1), (12, "SYWE2741.JPG", T1), (13, "SYWE2742.JPG", T1)]
        assert pick_twins(bulk, [("E1002740.JPG", T1)], set()) == ([11], [])

    def test_seconds_without_a_live_photo_stay(self):
        bulk = [(11, "SYWE2740.JPG", T1), (14, "SYWE2743.JPG", T2)]
        assert pick_twins(bulk, [("E1002740.JPG", T1)], set()) == ([11], [])

    def test_verified_copy_is_kept_and_listed(self):
        bulk = [(11, "SYWE2740.JPG", T1)]
        assert pick_twins(bulk, [("E1002740.JPG", T1)], {11}) == ([], [11])

    def test_no_live_photos_no_doubles(self):
        bulk = [(11, "SYWE2740.JPG", T1), (12, "SYWE2741.JPG", T1)]
        assert pick_twins(bulk, [], set()) == ([], [])

    def test_two_4g_photos_in_one_second(self):
        bulk = [(11, "A.JPG", T1), (12, "B.JPG", T1), (13, "C.JPG", T1)]
        live = [("E1.JPG", T1), ("E2.JPG", T1)]
        assert pick_twins(bulk, live, set()) == ([11, 12], [])
