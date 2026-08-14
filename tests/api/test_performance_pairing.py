"""Tests for the confusion matrix subject pairing.

The matrix used to collapse each image to one label per side, so an image
holding a person next to a car came out as an error even though the AI named
both. These cases are taken from real verified images on the Drenthe server,
where 8 of the 9 off-diagonal cells were exactly that.
"""
from __future__ import annotations

import os
import sys
from collections import Counter

_api = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "services", "api")
)
if _api not in sys.path:
    sys.path.insert(0, _api)

from utils.performance_pairing import EMPTY, pair_image_labels  # noqa: E402


def _pairs(human, ai):
    """Sorted pairs, so a test never depends on emission order."""
    return sorted(pair_image_labels(human, ai))


def test_single_subject_agreement():
    assert _pairs({"badger": 1}, {"badger": 1}) == [("badger", "badger")]


def test_person_next_to_a_car_is_two_agreements():
    # Drenthe images 18, 19, 23, 24, 1342, 1345. The old top-1 rule scored
    # these as person -> vehicle or vehicle -> person.
    assert _pairs({"person": 1, "vehicle": 1}, {"person": 1, "vehicle": 1}) == [
        ("person", "person"),
        ("vehicle", "vehicle"),
    ]


def test_dog_next_to_its_owner_is_two_agreements():
    # Drenthe images 15 and 17, the two the report was raised about.
    assert _pairs({"dog": 1, "person": 1}, {"dog": 1, "person": 1}) == [
        ("dog", "dog"),
        ("person", "person"),
    ]


def test_missed_subject_goes_to_the_empty_column():
    # Drenthe image 26. Two people found, and a dog the detector put below
    # the project threshold, so it never reached the classifier.
    assert _pairs({"person": 2, "dog": 1}, {"person": 2}) == [
        ("dog", EMPTY),
        ("person", "person"),
        ("person", "person"),
    ]


def test_invented_subject_goes_to_the_empty_row():
    # Drenthe image 166. Nobody recorded anything, the AI called it a bird.
    assert _pairs({}, {"bird": 1}) == [(EMPTY, "bird")]


def test_nothing_on_either_side_counts_once_as_correctly_empty():
    # Rejecting an empty frame is most of what the classifier does, so it
    # has to stay visible instead of dropping out of the matrix.
    assert pair_image_labels({}, {}) == [(EMPTY, EMPTY)]


def test_a_real_species_mixup_stays_off_the_diagonal():
    # The whole point of the matrix. Leftovers on both sides pair up.
    assert _pairs({"roe_deer": 1}, {"red_deer": 1}) == [("roe_deer", "red_deer")]


def test_partial_count_disagreement_splits_into_match_and_miss():
    assert _pairs({"wild_boar": 3}, {"wild_boar": 1}) == [
        ("wild_boar", EMPTY),
        ("wild_boar", EMPTY),
        ("wild_boar", "wild_boar"),
    ]


def test_over_count_splits_into_match_and_false_positive():
    assert _pairs({"fox": 1}, {"fox": 3}) == [
        (EMPTY, "fox"),
        (EMPTY, "fox"),
        ("fox", "fox"),
    ]


def test_agreements_are_taken_before_leftovers_are_paired():
    # The person is an agreement, so the leftover dog must pair with the
    # leftover cat rather than the AI's person stealing the dog.
    assert _pairs({"person": 1, "dog": 1}, {"person": 1, "cat": 1}) == [
        ("dog", "cat"),
        ("person", "person"),
    ]


def test_leftover_pairing_is_deterministic():
    # Nothing says which AI subject belongs to which human subject here, so
    # the only guarantee is that the answer never changes between runs.
    human = {"roe_deer": 1, "wild_boar": 1}
    ai = {"red_deer": 1, "chamois": 1}
    first = pair_image_labels(human, ai)
    assert first == pair_image_labels(dict(reversed(list(human.items()))), ai)
    assert first == pair_image_labels(human, dict(reversed(list(ai.items()))))


def test_every_subject_produces_exactly_one_cell():
    human = {"person": 2, "dog": 1, "roe_deer": 1}
    ai = {"person": 1, "dog": 1, "red_deer": 1, "vehicle": 1}
    pairs = pair_image_labels(human, ai)
    assert len(pairs) == max(sum(human.values()), sum(ai.values()))


def test_zero_counts_are_ignored():
    assert pair_image_labels({"fox": 0}, {"fox": 0}) == [(EMPTY, EMPTY)]


def test_drenthe_verified_set_reproduces_the_audited_numbers():
    """The full 27 verified images from the Drenthe project, 14 Aug 2026.

    The old image-level top-1 matrix scored 18 of 27 images correct (67%).
    Only two of those disagreements are real: one dog the detector missed
    and one bird the AI invented.
    """
    images = (
        # 8 images where the human and AI label sets are identical but the
        # old rule scored them as errors.
        [({"dog": 1, "person": 1}, {"dog": 1, "person": 1})] * 2
        + [({"person": 1, "vehicle": 1}, {"person": 1, "vehicle": 1})] * 6
        # the two genuine errors
        + [({"person": 2, "dog": 1}, {"person": 2})]
        + [({}, {"bird": 1})]
        # the images the old rule already scored correctly
        + [({"person": 1}, {"person": 1})] * 4
        + [({"person": 2}, {"person": 2})] * 2
        + [({"vehicle": 1}, {"vehicle": 1})] * 3
        + [({"badger": 1}, {"badger": 1})] * 3
        + [({"fox": 1}, {"fox": 1})] * 3
        + [({"dog": 1}, {"dog": 1})]
        + [({"lagomorph": 1}, {"lagomorph": 1})]
    )
    assert len(images) == 27

    cells: Counter = Counter()
    for human, ai in images:
        cells.update(pair_image_labels(human, ai))

    matched = sum(n for (gt, pred), n in cells.items() if gt == pred)
    total = sum(cells.values())
    assert (matched, total) == (37, 39)

    off_diagonal = {(gt, pred): n for (gt, pred), n in cells.items() if gt != pred}
    assert off_diagonal == {("dog", EMPTY): 1, (EMPTY, "bird"): 1}
