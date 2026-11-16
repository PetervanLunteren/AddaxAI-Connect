"""
Which files of a bulk upload are already in the project.

One rule, used by the pre-flight check in the API and by the cleanup script
for doubles that were imported before the rule existed.

The camera clock second is the key. Per second, for one camera:

1. A file with the same name as an image already there is that image. Skip it.
2. Images left over at that second have other names. A 4G camera sends the
   first photo of a burst under its own name and at a lower resolution, so the
   bytes never match the SD card copy. Skip that many of the remaining files,
   first by name.

So a burst of three files against one 4G photo uploads two, a second upload of
the same folder uploads nothing, and a burst with one frame missing in the
project uploads exactly that frame.
"""
import re
from collections import Counter, defaultdict
from datetime import datetime
from typing import Dict, List, Sequence, Tuple

# A file name and its camera clock second.
NamedTime = Tuple[str, datetime]


def safe_basename(name: str) -> str:
    """
    Strip directory components and replace unsafe characters.

    Bulk images are stored under this name, so comparing names must go
    through it on both sides. Applying it twice gives the same result.
    """
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_")
    return cleaned or "image.jpg"


def files_already_present(
    files: Sequence[NamedTime], existing: Sequence[NamedTime]
) -> List[int]:
    """
    Return the indexes into `files` that are already in the project.

    `files` are the uploaded or scanned files, `existing` the images of the
    same camera at those seconds. Both are (name, captured_at) pairs.
    """
    existing_names: Dict[datetime, Counter] = defaultdict(Counter)
    for name, captured_at in existing:
        existing_names[captured_at][safe_basename(name)] += 1

    files_by_second: Dict[datetime, List[int]] = defaultdict(list)
    for index, (_name, captured_at) in enumerate(files):
        files_by_second[captured_at].append(index)

    skip: List[int] = []
    for captured_at, indexes in files_by_second.items():
        left_over = existing_names.get(captured_at, Counter()).copy()
        unmatched: List[int] = []
        for index in sorted(indexes, key=lambda i: (safe_basename(files[i][0]), i)):
            name = safe_basename(files[index][0])
            if left_over[name] > 0:
                left_over[name] -= 1
                skip.append(index)
            else:
                unmatched.append(index)
        skip.extend(unmatched[: sum(left_over.values())])
    return sorted(skip)
