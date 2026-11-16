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


class TestIsOldJob:
    def test_job_from_before_the_rule(self):
        summary = {"queued_for_pipeline": 2496, "duplicates": 1495, "other_skipped": 0}
        assert remove_live_twins.is_old_job({"process_summary": summary})

    def test_job_from_the_new_worker_is_left_alone(self):
        # Its upload already left the 4G copies out; comparing it again
        # would remove real burst frames (seen on dev, job 12).
        summary = {"queued_for_pipeline": 14, "duplicates": 0, "other_skipped": 0, "skip_reasons": {}}
        assert not remove_live_twins.is_old_job({"process_summary": summary})

    def test_job_without_summary_counts_as_old(self):
        assert remove_live_twins.is_old_job({})


class TestWithRemoved:
    def test_removed_images_count_as_duplicates(self):
        manifest = {"process_summary": {"queued_for_pipeline": 2499, "duplicates": 0, "other_skipped": 0}}
        out = remove_live_twins.with_removed(manifest, [1, 2, 3])
        assert out["live_twins_removed"] == [1, 2, 3]
        assert out["process_summary"] == {"queued_for_pipeline": 2496, "duplicates": 3, "other_skipped": 0}

    def test_input_is_not_changed(self):
        manifest = {"process_summary": {"queued_for_pipeline": 5, "duplicates": 0}}
        remove_live_twins.with_removed(manifest, [1])
        assert manifest == {"process_summary": {"queued_for_pipeline": 5, "duplicates": 0}}

    def test_nothing_removed_only_marks_the_job(self):
        out = remove_live_twins.with_removed({"process_summary": {"queued_for_pipeline": 5, "duplicates": 0}}, [])
        assert out["live_twins_removed"] == []
        assert out["process_summary"]["queued_for_pipeline"] == 5
