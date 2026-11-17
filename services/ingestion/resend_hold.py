"""
Hold an incomplete photo for a while, so the camera can complete it.

Some cameras recover from an upload that broke halfway (the profile flag
`resends_broken_uploads`). Measured on a Willfine 4.0T CG, the camera first
sends the rest of the file as a loose piece, without a JPEG header, under the
same file name. Then it sends the whole photo once more. Without a hold, the
broken first copy becomes an image, the loose piece a rejection, and the
second copy a second image of the same photo.

The rule, per photo (same camera, same file name, same camera clock second):

- A complete copy enters at once. Complete means it ends with the JPEG end
  marker. Held copies of the same photo are dropped.
- An incomplete copy is held in uploads/held/, for HOLD_SECONDS counted from
  the first copy. Every incomplete copy is kept until the choice is made.
- A loose piece is glued onto the newest held copy with its file name,
  because the camera continues the upload it broke off last. When that gives
  a complete photo, it enters at once.
- When the hold is over, the biggest held copy enters as it is. Truncated
  photos are never blocked; a cut-off photo still holds a lot of useful data.
- A copy of a photo that is already an image is dropped. Only when it is
  better than the stored copy does the caller reject it as late_duplicate,
  because then the hold was too short and we want to see that.

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
from typing import Dict, List, Optional, Tuple

# Measured on lab (Namibia, Nov 2026), counted from the first copy: the loose
# piece that completes a photo came after 6 to 154 seconds, the second copy
# after 25 to 125. Three minutes covers both.
HOLD_SECONDS = 180

# Folder under the upload root. The watcher and the startup scan skip it.
HELD_DIR_NAME = "held"

JPEG_START_MARKER = b"\xff\xd8\xff"
JPEG_END_MARKER = b"\xff\xd9"

_SEP = "__"
_CAPTURED_FORMAT = "%Y%m%dT%H%M%S"


def starts_with_jpeg_start_marker(path: str) -> bool:
    with open(path, "rb") as f:
        return f.read(len(JPEG_START_MARKER)) == JPEG_START_MARKER


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


def join_target(photos: Dict[PhotoKey, Copies], filename: str) -> Optional[Tuple[HeldCopy, Path]]:
    """
    The held copy a loose piece with this file name continues, or None.

    A loose piece has no EXIF, so the file name is all that ties it to a
    photo. It continues the upload the camera broke off last, which is the
    newest held copy. When two held photos share the name (two cameras at the
    same counter), there is no telling whose piece it is, so nothing is joined.
    """
    named = [copies for photo, copies in photos.items() if photo[2] == filename]
    if len(named) != 1:
        return None
    return named[0][-1]


@dataclass(frozen=True)
class StoredCopy:
    """What is known about the copy of a photo that is already an image."""
    size: Optional[int]  # None when it could not be read
    complete: bool


class Action(Enum):
    DROP_LATE = "drop_late"      # already an image, this copy adds nothing
    REJECT_LATE = "reject_late"  # already an image, but this copy is better
    INGEST_NOW = "ingest_now"    # complete, enters now; held copies are dropped
    HOLD = "hold"                # incomplete, waits for a better copy


def decide(new_size: int, new_complete: bool, stored: Optional[StoredCopy]) -> Action:
    """
    What to do with a copy that just arrived.

    A copy of a photo that is already an image is normal: the camera sends a
    broken photo once more whatever became of the pieces. It only matters
    when it is better than the stored copy. A stored copy of unknown size
    counts as worse, so that case stays visible.
    """
    if stored is not None:
        if stored.complete:
            return Action.DROP_LATE
        if new_complete or stored.size is None or new_size > stored.size:
            return Action.REJECT_LATE
        return Action.DROP_LATE
    return Action.INGEST_NOW if new_complete else Action.HOLD
