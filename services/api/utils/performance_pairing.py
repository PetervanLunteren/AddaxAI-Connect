"""
Subject-level pairing between human observations and AI predictions.

The confusion matrix compares what a validator recorded on an image against
what the AI predicted on the same image. A camera trap image often holds more
than one subject: a person next to a car, a dog next to its owner. Collapsing
such an image to one label per side turns a fully correct prediction into an
off-diagonal cell, so this module pairs subject by subject instead.

Neither side carries boxes the other side can be matched against. A
HumanObservation is a species plus a count for the whole image, and the AI
side is a set of detections. So the pairing runs on multisets of labels:

1. Labels present on both sides pair off first, min(human, ai) times. These
   are agreements and land on the diagonal.
2. Whatever is left over on both sides pairs off in label order. These are
   real confusions, one class mistaken for another.
3. Human labels still left over were missed by the AI and go to
   (species, "empty").
4. AI labels still left over were invented by the AI and go to
   ("empty", species).
5. An image where neither side found anything counts once as ("empty",
   "empty"). Correctly rejecting a frame with nothing in it is most of what
   a camera trap classifier does, so it must stay visible in the matrix.

Step 2 is ambiguous when both sides have more than one label left over, since
nothing tells us which AI subject belongs to which human subject. Sorting both
sides by label keeps the outcome deterministic. This case is far rarer than
the person-plus-vehicle case that motivated the module.

The "empty" class therefore works exactly like the background class in object
detection evaluation: its row holds the correctly empty images plus every
false positive, and its column holds the correctly empty images plus every
missed subject.
"""
from collections import Counter
from typing import List, Mapping, Tuple

EMPTY = "empty"


def _flatten(counts: Mapping[str, int]) -> List[str]:
    """Expand a label multiset into a sorted list of one entry per subject."""
    out: List[str] = []
    for label in sorted(counts):
        out.extend([label] * counts[label])
    return out


def pair_image_labels(
    human_labels: Mapping[str, int],
    ai_labels: Mapping[str, int],
) -> List[Tuple[str, str]]:
    """
    Pair one image's human labels against its AI labels.

    Both inputs map a label to how many subjects carry it. Returns one
    (true_class, predicted_class) tuple per subject, ready to be counted into
    the confusion matrix.
    """
    human_left = Counter({k: v for k, v in human_labels.items() if v > 0})
    ai_left = Counter({k: v for k, v in ai_labels.items() if v > 0})

    if not human_left and not ai_left:
        return [(EMPTY, EMPTY)]

    pairs: List[Tuple[str, str]] = []

    # 1. Same label on both sides is an agreement.
    for label in sorted(set(human_left) & set(ai_left)):
        matched = min(human_left[label], ai_left[label])
        pairs.extend([(label, label)] * matched)
        human_left[label] -= matched
        ai_left[label] -= matched

    human_rest = _flatten(human_left)
    ai_rest = _flatten(ai_left)

    # 2. Leftovers on both sides are genuine confusions.
    pairs.extend(zip(human_rest, ai_rest))

    # 3. Human subjects with nothing left to pair against were missed.
    pairs.extend((label, EMPTY) for label in human_rest[len(ai_rest):])

    # 4. AI subjects with nothing left to pair against were invented.
    pairs.extend((EMPTY, label) for label in ai_rest[len(human_rest):])

    return pairs
