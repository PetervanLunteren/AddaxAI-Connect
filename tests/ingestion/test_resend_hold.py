"""
Tests for the hold rule of cameras that recover from a broken upload.

The pure rule (resend_hold.py) and how main.py applies it to files on disk.
The database, storage and pipeline are replaced by recorders, so these tests
only check which copy is stored, held, dropped or rejected.
"""
from datetime import datetime, timedelta, timezone

import pytest

import main
from resend_hold import (
    HOLD_SECONDS,
    Action,
    HeldCopy,
    StoredCopy,
    biggest_copy,
    decide,
    ends_with_jpeg_end_marker,
    held_name,
    held_photos,
    hold_is_over,
    join_target,
    parse_held_name,
    starts_with_jpeg_start_marker,
)
from shared.camera_profiles import CAMERA_PROFILES, WILLFINE_2025_PROFILE

DEVICE = "861943071188840"
CAPTURED = datetime(2026, 11, 17, 16, 26, 52)
NAME = "SP1-E1000212.JPG"

# A "photo" of about 1000 bytes. Cutting it anywhere gives a first piece and
# the loose piece that completes it, like a broken upload does.
COMPLETE = b"\xff\xd8\xff" + bytes(range(256)) * 4 + b"\xff\xd9"


def first_piece(size: int) -> bytes:
    return COMPLETE[:size]


def rest_after(size: int) -> bytes:
    return COMPLETE[size:]


# --- the pure rule -----------------------------------------------------------

def test_markers(tmp_path):
    whole = tmp_path / "whole.jpg"
    whole.write_bytes(COMPLETE)
    head = tmp_path / "head.jpg"
    head.write_bytes(first_piece(300))
    rest = tmp_path / "rest.jpg"
    rest.write_bytes(rest_after(300))
    empty = tmp_path / "empty.jpg"
    empty.write_bytes(b"")

    assert starts_with_jpeg_start_marker(str(whole)) and ends_with_jpeg_end_marker(str(whole))
    assert starts_with_jpeg_start_marker(str(head)) and not ends_with_jpeg_end_marker(str(head))
    assert not starts_with_jpeg_start_marker(str(rest)) and ends_with_jpeg_end_marker(str(rest))
    assert not starts_with_jpeg_start_marker(str(empty)) and not ends_with_jpeg_end_marker(str(empty))


def test_held_name_round_trip():
    copy = HeldCopy(1763400000123, DEVICE, CAPTURED, "odd__name.JPG")
    assert parse_held_name(held_name(copy)) == copy


@pytest.mark.parametrize("name", ["E1000212.JPG", "abc__def__ghi", "x__1__20261117T162652__"])
def test_foreign_names_do_not_parse(name):
    with pytest.raises(ValueError):
        parse_held_name(name)


def hold(folder, arrived_ms, data=b"x", device=DEVICE, captured=CAPTURED, name=NAME):
    path = folder / held_name(HeldCopy(arrived_ms, device, captured, name))
    path.write_bytes(data)
    return path


def test_held_photos_groups_copies_oldest_first(tmp_path):
    second = hold(tmp_path, 2000)
    first = hold(tmp_path, 1000)
    other = hold(tmp_path, 1500, captured=CAPTURED + timedelta(seconds=1))
    stray = tmp_path / "junk.JPG"
    stray.write_bytes(b"x")

    photos, strays = held_photos(tmp_path)

    assert [path for _, path in photos[(DEVICE, CAPTURED, NAME)]] == [first, second]
    assert [path for _, path in photos[(DEVICE, CAPTURED + timedelta(seconds=1), NAME)]] == [other]
    assert strays == [stray]
    assert held_photos(tmp_path / "missing") == ({}, [])


def test_hold_counts_from_the_first_copy(tmp_path):
    hold(tmp_path, 1_000_000)
    hold(tmp_path, 1_100_000)
    (copies,) = held_photos(tmp_path)[0].values()

    assert not hold_is_over(copies, 1000 + HOLD_SECONDS - 1)
    assert hold_is_over(copies, 1000 + HOLD_SECONDS)


def test_biggest_copy_and_tie(tmp_path):
    small = hold(tmp_path, 1000, b"x" * 10)
    big = hold(tmp_path, 2000, b"x" * 30)
    same = hold(tmp_path, 3000, b"x" * 30)
    (copies,) = held_photos(tmp_path)[0].values()

    assert biggest_copy(copies) == big
    assert small.exists() and same.exists()


def test_loose_piece_continues_the_newest_copy(tmp_path):
    # lab SP1-E1000018: 360448 bytes came first, then 262144 + 125837. The
    # piece belongs to the second, smaller copy.
    hold(tmp_path, 1000, b"x" * 30)
    newest = hold(tmp_path, 2000, b"x" * 20)
    photos, _ = held_photos(tmp_path)

    assert join_target(photos, NAME)[1] == newest
    assert join_target(photos, "other.JPG") is None


def test_no_join_when_two_photos_share_the_name(tmp_path):
    hold(tmp_path, 1000)
    hold(tmp_path, 2000, device="861943070066146")
    photos, _ = held_photos(tmp_path)

    assert join_target(photos, NAME) is None


@pytest.mark.parametrize("new_size, new_complete, stored, expected", [
    (100, True, None, Action.INGEST_NOW),
    (100, False, None, Action.HOLD),
    (100, True, StoredCopy(900, True), Action.DROP_LATE),
    (100, False, StoredCopy(None, True), Action.DROP_LATE),
    (100, True, StoredCopy(900, False), Action.REJECT_LATE),
    (200, False, StoredCopy(100, False), Action.REJECT_LATE),
    (100, False, StoredCopy(None, False), Action.REJECT_LATE),
    (100, False, StoredCopy(100, False), Action.DROP_LATE),
    (50, False, StoredCopy(100, False), Action.DROP_LATE),
])
def test_decide(new_size, new_complete, stored, expected):
    assert decide(new_size, new_complete, stored) is expected


def test_only_willfine_recovers_this_way():
    assert WILLFINE_2025_PROFILE.resends_broken_uploads
    others = [p.name for p in CAMERA_PROFILES if p.resends_broken_uploads and p is not WILLFINE_2025_PROFILE]
    assert others == []


# --- main.py applying the rule -----------------------------------------------

@pytest.fixture
def ingest(tmp_path, monkeypatch):
    """Upload root plus recorders for everything outside the file system."""
    monkeypatch.setattr(main.settings, "ftps_upload_dir", str(tmp_path))
    state = {"root": tmp_path, "existing": None, "stored_copy": StoredCopy(None, False),
             "stored": [], "rejected": [], "now": 1_763_400_000.0}

    monkeypatch.setattr(main, "find_same_photo", lambda *a: state["existing"])
    monkeypatch.setattr(main, "stored_copy", lambda path: state["stored_copy"])
    monkeypatch.setattr(main.time, "time", lambda: state["now"])

    def store(path, held=None):
        with open(path, "rb") as f:
            state["stored"].append(f.read())
        main.os.remove(path)

    def reject(filepath, reason, details=None, **kw):
        state["rejected"].append((reason, details))
        main.os.remove(filepath)

    # A held copy is stored through process_image, a fresh upload through
    # _store_image. Both end in the same recorder.
    monkeypatch.setattr(main, "process_image", store)
    monkeypatch.setattr(main, "_store_image", lambda path, *a: store(path))
    monkeypatch.setattr(main, "_reject", reject)
    return state


def upload(state, data: bytes) -> None:
    """A file arrives under the camera's name: join it or run the hold step."""
    path = state["root"] / NAME
    path.write_bytes(data)
    if main._join_loose_piece(str(path), NAME):
        return
    if not main.starts_with_jpeg_start_marker(str(path)):
        main._reject(str(path), "validation_failed", "no JPEG header")
        return
    with main._hold_lock:
        if main._hold_step(str(path), NAME, DEVICE, 9, CAPTURED, {}):
            main._store_image(str(path))


def held(state):
    folder = state["root"] / "held"
    return sorted((p.read_bytes() for p in folder.iterdir()), key=len) if folder.is_dir() else []


def test_complete_photo_enters_at_once(ingest):
    upload(ingest, COMPLETE)
    assert ingest["stored"] == [COMPLETE]
    assert held(ingest) == []


def test_loose_piece_completes_the_held_photo(ingest):
    upload(ingest, first_piece(600))
    assert ingest["stored"] == [] and held(ingest) == [first_piece(600)]

    upload(ingest, rest_after(600))
    assert ingest["stored"] == [COMPLETE]
    assert held(ingest) == [] and ingest["rejected"] == []


def test_loose_piece_joins_the_newest_copy_and_the_older_one_goes(ingest):
    upload(ingest, first_piece(800))
    ingest["now"] += 60
    upload(ingest, first_piece(500))
    upload(ingest, rest_after(500))

    assert ingest["stored"] == [COMPLETE]
    assert held(ingest) == []


def test_piece_without_the_end_of_the_photo_is_rejected_as_before(ingest):
    upload(ingest, first_piece(400))
    upload(ingest, COMPLETE[400:700])

    assert held(ingest) == [first_piece(400)]
    assert [reason for reason, _ in ingest["rejected"]] == ["validation_failed"]


def test_piece_without_a_held_photo_is_rejected_as_before(ingest):
    upload(ingest, rest_after(600))
    assert ingest["stored"] == []
    assert [reason for reason, _ in ingest["rejected"]] == ["validation_failed"]


def test_complete_copy_drops_the_held_ones(ingest):
    upload(ingest, first_piece(300))
    upload(ingest, first_piece(500))
    upload(ingest, COMPLETE)

    assert ingest["stored"] == [COMPLETE]
    assert held(ingest) == []


def test_biggest_copy_is_stored_when_the_hold_is_over(ingest):
    upload(ingest, first_piece(300))
    ingest["now"] += 100
    upload(ingest, first_piece(700))
    assert held(ingest) == [first_piece(300), first_piece(700)]

    ingest["now"] += HOLD_SECONDS - 101
    main.release_held_images()
    assert ingest["stored"] == []

    ingest["now"] += 1
    main.release_held_images()
    assert ingest["stored"] == [first_piece(700)]
    assert held(ingest) == []


def test_stray_file_in_the_hold_folder_is_rejected(ingest):
    (ingest["root"] / "held").mkdir()
    (ingest["root"] / "held" / "junk.JPG").write_bytes(b"x")

    main.release_held_images()
    assert [reason for reason, _ in ingest["rejected"]] == ["validation_failed"]


def already_stored(state, stored: StoredCopy, removed: bool = False) -> None:
    state["existing"] = {
        "ingested_at": datetime.fromtimestamp(state["now"], timezone.utc) - timedelta(seconds=214),
        "storage_path": "861943071188840/2026/11/x_SP1-E1000212.JPG",
        "privacy_removed_at": datetime.now(timezone.utc) if removed else None,
    }
    state["stored_copy"] = stored


def test_resend_of_a_photo_that_is_stored_complete_is_dropped_quietly(ingest):
    already_stored(ingest, StoredCopy(1000, True))
    upload(ingest, COMPLETE)
    upload(ingest, first_piece(600))

    assert ingest["stored"] == [] and ingest["rejected"] == [] and held(ingest) == []


def test_better_copy_after_the_hold_is_rejected_as_late(ingest):
    already_stored(ingest, StoredCopy(180224, False))
    upload(ingest, COMPLETE)

    assert ingest["stored"] == []
    ((reason, details),) = ingest["rejected"]
    assert reason == "late_duplicate"
    assert "complete" in details and "180224 bytes" in details


def test_late_copy_that_is_not_better_is_dropped(ingest):
    already_stored(ingest, StoredCopy(700, False))
    upload(ingest, first_piece(600))

    assert ingest["rejected"] == [] and held(ingest) == []


def test_nothing_brings_a_privacy_removed_photo_back(ingest):
    already_stored(ingest, StoredCopy(None, False), removed=True)
    upload(ingest, COMPLETE)

    assert ingest["stored"] == [] and ingest["rejected"] == []
