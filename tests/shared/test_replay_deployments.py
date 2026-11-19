"""The comparison and the reasons in scripts/replay_deployments.py, without a database."""
import importlib.util
import math
import os
from datetime import date, datetime

_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "replay_deployments.py")
_spec = importlib.util.spec_from_file_location("replay_deployments", _PATH)
replay = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(replay)

HOME = (53.2600, 5.1800)
CUTOFF = datetime(2026, 7, 7, 12, 0)
BEFORE = datetime(2026, 7, 1)
AFTER = datetime(2026, 8, 1)


def east(point, metres):
    lat, lon = point
    return (lat, lon + metres / (111_320.0 * math.cos(math.radians(lat))))


FAR = east(HOME, 1500)


def at(day, hour=12):
    return datetime(2026, 3, day, hour)


def photo(id, point, day, deployment_id, ingested=AFTER, hour=12):
    return replay.Photo(id, at(day, hour), ingested, point[0], point[1], deployment_id)


def stored(id, start, end, point, count=1):
    return replay.Stored(id, start, end, point[0], point[1], count)


def camera(photos, stored_rows, **flags):
    return replay.Camera(1, "CAM01", 1, photos, stored_rows, **flags)


def run(cam):
    return replay.replay_camera(cam, CUTOFF)


# One camera that moved once, as live ingestion stores it.
MOVED_PHOTOS = [
    photo(1, HOME, 1, 10), photo(2, HOME, 2, 10),
    photo(3, FAR, 10, 11), photo(4, FAR, 11, 11),
]
MOVED_STORED = [
    stored(10, date(2026, 3, 1), date(2026, 3, 9), HOME, 2),
    stored(11, date(2026, 3, 10), None, FAR),
]


def test_a_history_as_stored_is_the_same():
    result = run(camera(MOVED_PHOTOS, MOVED_STORED))
    assert result.reason == "same"
    assert (result.built, result.stored) == (2, 2)


def test_an_old_sd_card_differs_only_in_capture_order():
    """Photos 3 and 4 were taken first, elsewhere, but arrived last. Live
    ingestion made them a move (deployment numbers 1 then 2), which the
    rebuild in arrival order repeats. In capture order the history differs."""
    photos = [
        photo(1, HOME, 20, 10), photo(2, HOME, 21, 10),
        photo(3, FAR, 2, 11), photo(4, FAR, 3, 11),
    ]
    # In deployment_number order, as the loader returns them.
    stored_rows = [
        stored(10, date(2026, 3, 20), date(2026, 3, 20), HOME, 2),
        stored(11, date(2026, 3, 2), None, FAR),
    ]
    result = run(camera(photos, stored_rows))
    assert result.reason == "arrival order"
    assert result.difference.startswith("deployment 1: built 2026-03-02")


def test_a_hand_correction_is_set_by_a_person():
    folded = [stored(10, date(2026, 3, 1), None, HOME, 2)]
    photos = [photo(p.id, (p.lat, p.lon), p.taken_at.day, 10) for p in MOVED_PHOTOS]
    assert run(camera(photos, folded, hand_corrected=True)).reason == "set by a person"


def test_an_upload_comes_before_the_other_reasons():
    folded = [stored(10, date(2026, 3, 1), None, HOME, 2)]
    photos = [photo(p.id, (p.lat, p.lon), p.taken_at.day, 10) for p in MOVED_PHOTOS]
    assert run(camera(photos, folded, has_upload=True)).reason == "set by an upload"


def test_a_retired_camera_with_a_closed_last_deployment():
    closed = [MOVED_STORED[0], stored(11, date(2026, 3, 10), date(2026, 3, 11), FAR)]
    assert run(camera(MOVED_PHOTOS, closed, retired=True)).reason == "camera retired"


def test_a_first_deployment_before_the_first_photo_was_opened_by_a_report():
    early = [stored(10, date(2026, 2, 20), date(2026, 3, 9), HOME, 2), MOVED_STORED[1]]
    assert run(camera(MOVED_PHOTOS, early)).reason == "opened by a report"


def test_two_built_deployments_on_one_stored_one_were_merged():
    folded = [stored(10, date(2026, 3, 1), None, HOME, 2)]
    photos = [photo(p.id, (p.lat, p.lon), p.taken_at.day, 10) for p in MOVED_PHOTOS]
    assert run(camera(photos, folded)).reason == "merged at one site"


def test_a_pin_averaged_from_more_readings_than_are_left_means_photos_were_deleted():
    """spw camera 861943072916181: 114 readings in the pin, 62 photos left."""
    photos = [photo(1, HOME, 1, 10), photo(2, HOME, 2, 10)]
    pulled = [stored(10, date(2026, 3, 1), None, east(HOME, 15), count=5)]
    assert run(camera(photos, pulled)).reason == "photos deleted"


def test_a_difference_in_photos_from_before_the_cutoff_is_an_older_rule():
    # The old 100 m rule split at 150 m; today's rule keeps one deployment.
    near = east(HOME, 150)
    photos = [photo(1, HOME, 1, 10, BEFORE), photo(2, near, 2, 11, BEFORE), photo(3, near, 3, 11, BEFORE)]
    old_split = [stored(10, date(2026, 3, 1), date(2026, 3, 1), HOME), stored(11, date(2026, 3, 2), None, near, 2)]
    assert run(camera(photos, old_split)).reason == "older rule"


def test_the_same_difference_after_the_cutoff_is_unexplained():
    near = east(HOME, 150)
    photos = [photo(1, HOME, 1, 10), photo(2, near, 2, 11), photo(3, near, 3, 11)]
    old_split = [stored(10, date(2026, 3, 1), date(2026, 3, 1), HOME), stored(11, date(2026, 3, 2), None, near, 2)]
    result = run(camera(photos, old_split))
    assert result.reason == "unexplained"
    assert result.difference == "1 built, 2 stored"


def test_a_pin_off_by_more_than_a_metre_is_a_difference():
    moved_pin = [MOVED_STORED[0], stored(11, date(2026, 3, 10), None, east(FAR, 5))]
    assert run(camera(MOVED_PHOTOS, moved_pin)).difference == "deployment 2: pins 5 m apart"


def test_a_photo_on_another_deployment_is_a_difference():
    photos = MOVED_PHOTOS[:3] + [photo(4, FAR, 11, 10)]
    diff = replay.first_difference(
        replay.build_deployments([replay._reading(p) for p in photos]), MOVED_STORED, photos,
    )
    assert diff == "photo 4 on a different deployment"


def test_summary_counts_per_project():
    results = [
        replay.Result(1, "A", 1, "same", seconds=0.01),
        replay.Result(2, "B", 1, "older rule", seconds=0.05),
        replay.Result(3, "C", 2, "same", seconds=0.02),
    ]
    summary = replay.summarise(results)
    assert summary["per_project"] == {"1": {"same": 1, "older rule": 1}, "2": {"same": 1}}
    assert summary["total"] == {"same": 2, "older rule": 1}
    assert summary["slowest_camera"] == "B"
