"""The choice in scripts/remove_resent_copies.py, without a database."""
import importlib.util
import os

_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "scripts", "remove_resent_copies.py")
_spec = importlib.util.spec_from_file_location("remove_resent_copies", _PATH)
remove_resent_copies = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(remove_resent_copies)
Copy = remove_resent_copies.Copy
pick_copies = remove_resent_copies.pick_copies


def copy(id, size, worked_on=False, privacy_removed=False):
    return Copy(id=id, size=size, worked_on=worked_on, privacy_removed=privacy_removed)


def test_biggest_copy_stays():
    # lab SP1-E1000018: two truncated copies, the second smaller.
    assert pick_copies([copy(3629, 360448), copy(3630, 262144)]) == ([3629], [3630])


def test_complete_resend_beats_the_truncated_first_copy():
    assert pick_copies([copy(1, 180224), copy(2, 257049)]) == ([2], [1])


def test_tie_keeps_the_oldest_row():
    assert pick_copies([copy(5, 100), copy(4, 100)]) == ([4], [5])


def test_unknown_size_deletes_nothing():
    assert pick_copies([copy(1, None), copy(2, 10)]) == ([1, 2], [])


def test_unknown_size_does_not_block_the_person_rule():
    assert pick_copies([copy(1, None, worked_on=True), copy(2, None)]) == ([1], [2])


def test_copy_worked_on_by_a_person_stays_even_when_smaller():
    assert pick_copies([copy(1, 100, worked_on=True), copy(2, 900)]) == ([1], [2])


def test_several_worked_on_copies_all_stay():
    # lab SP1-E1000110: both copies verified as brown hyaena.
    assert pick_copies([copy(3742, 200, worked_on=True), copy(3743, 300, worked_on=True)]) == ([3742, 3743], [])


def test_privacy_placeholder_stays_so_the_person_does_not_come_back():
    assert pick_copies([copy(1, None, privacy_removed=True), copy(2, 900)]) == ([1], [2])
