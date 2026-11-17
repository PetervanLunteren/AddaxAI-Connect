"""
Hold an incomplete photo for a while, so the camera can send a better copy.

Some cameras send a photo once more when an upload broke halfway (the profile
flag `resends_broken_uploads`). Without a hold, the broken first copy becomes
an image, and the second copy a minute later a second image of the same photo.

The rule, per photo (same camera, same file name, same camera clock second):

- A complete copy enters at once. Complete means it ends with the JPEG end
  marker. Held copies of the same photo are dropped.
- An incomplete copy is held in uploads/held/, for HOLD_SECONDS counted from
  the first copy.
- When the hold is over, the biggest held copy enters as it is. Truncated
  photos are never blocked; a cut-off photo still holds a lot of useful data.
- A copy of a photo that is already an image is too late. The caller rejects
  it as late_duplicate with a warning, so we see when the hold is too short.

The loose piece a broken upload is continued with (no JPEG header) is not
used here; it is rejected as before. Joining it to the held copy was built
in commit 19aeb3ae and taken out again as too fragile (DEVELOPERS.md).

All state lives in the held files' names, so a restart of ingestion loses
nothing and there is no sidecar file to drift from the bytes.

Only pure functions here, no database and no storage, so the rule can be
tested on its own. main.py does the moving and the storing.
"""
import os
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Dict, List, Tuple

# Measured on lab (Namibia, Nov 2026): the camera sent the second copy 25 to
# 125 seconds after the first. Three minutes covers all of them with margin.
HOLD_SECONDS = 180

# Folder under the upload root. The watcher and the startup scan skip it.
HELD_DIR_NAME = "held"

JPEG_END_MARKER = b"\xff\xd9"

_SEP = "__"
_CAPTURED_FORMAT = "%Y%m%dT%H%M%S"


def ends_with_jpeg_end_marker(path: str) -> bool:
    """True when the file ends with the JPEG end marker, so its end arrived."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        if f.tell() < len(JPEG_END_MARKER):
            return False
        f.seek(-len(JPEG_END_MARKER), os.SEEK_END)
        return f.read() == JPEG_END_MARKER


# (device id, camera clock second, file name)
PhotoKey = Tuple[str, datetime, str]


@dataclass(frozen=True)
class HeldCopy:
    """Which photo a held file is a copy of, and when it arrived."""
    arrived_ms: int  # epoch milliseconds
    device_id: str
    captured_at: datetime
    filename: str

    @property
    def photo(self) -> PhotoKey:
        return (self.device_id, self.captured_at, self.filename)


def held_name(copy: HeldCopy) -> str:
    """The file name a held copy is stored under."""
    return _SEP.join([
        str(copy.arrived_ms),
        copy.device_id,
        copy.captured_at.strftime(_CAPTURED_FORMAT),
        copy.filename,
    ])


def parse_held_name(name: str) -> HeldCopy:
    """
    Read a held file name back.

    The file name of the photo comes last and may contain the separator
    itself, so the split stops after three parts.

    Raises:
        ValueError: the name was not made by held_name
    """
    parts = name.split(_SEP, 3)
    if len(parts) != 4 or not all(parts):
        raise ValueError(f"Not a held file name: {name!r}")
    arrived_ms, device_id, captured, filename = parts
    return HeldCopy(
        arrived_ms=int(arrived_ms),
        device_id=device_id,
        captured_at=datetime.strptime(captured, _CAPTURED_FORMAT),
        filename=filename,
    )


# The held copies of one photo with their files, oldest first.
Copies = List[Tuple[HeldCopy, Path]]


def held_photos(held_dir: Path) -> Tuple[Dict[PhotoKey, Copies], List[Path]]:
    """
    Everything in the hold folder: the copies per photo, and the strays.

    A stray is a file whose name held_name did not make. The caller rejects
    it instead of leaving it to sit forever.
    """
    photos: Dict[PhotoKey, Copies] = defaultdict(list)
    strays: List[Path] = []
    if not held_dir.is_dir():
        return photos, strays
    for path in held_dir.iterdir():
        if not path.is_file():
            continue
        try:
            copy = parse_held_name(path.name)
        except ValueError:
            strays.append(path)
            continue
        photos[copy.photo].append((copy, path))
    for copies in photos.values():
        copies.sort(key=lambda item: item[0].arrived_ms)
    return photos, strays


def hold_is_over(copies: Copies, now: float) -> bool:
    """The hold counts from the first copy, later copies do not extend it."""
    return now - copies[0][0].arrived_ms / 1000 >= HOLD_SECONDS


def biggest_copy(copies: Copies) -> Path:
    """The copy to store when the hold is over. A tie keeps the oldest."""
    return max(copies, key=lambda item: (item[1].stat().st_size, -item[0].arrived_ms))[1]


class Action(Enum):
    REJECT_LATE = "reject_late"  # already an image, the hold was too short
    INGEST_NOW = "ingest_now"    # complete, enters now; held copies are dropped
    HOLD = "hold"                # incomplete, waits for a better copy


def decide(new_complete: bool, already_stored: bool) -> Action:
    """What to do with a copy that just arrived."""
    if already_stored:
        return Action.REJECT_LATE
    return Action.INGEST_NOW if new_complete else Action.HOLD
