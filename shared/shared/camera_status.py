"""Camera liveness status.

Single source of truth for the 'active / inactive / never_reported' state
shown on the Cameras page, the camera detail sheet, the Insights ->
Deployment timeline, the camera export, and the email reports.

Liveness follows *last contact*: the most recent moment a camera reached
the server, either with a daily health report or with a live image.
Health reports alone are not enough. Some camera models send no daily
report at all (INSTAR), and report parsing can break while the camera
keeps delivering photos. In both cases a report-only rule marks a
perfectly healthy camera as silent.

Contact is measured with server receive times (`CameraHealthReport.created_at`,
`Image.ingested_at`), never with the camera clock. A camera trap clock is
often unset or years off when it is first deployed, which is exactly when
the status matters most. The camera alert rules and the theft watch
already define contact this way, so all three now agree.

Only live images count. A bulk upload is an SD card carried in by hand,
not the camera transmitting, so it must never make a stolen camera look
alive.

A retired camera (`Camera.retired_at` set) is `retired` whatever its last
contact. It left its project on purpose, with its data kept, so it must
never read as `inactive`, which is the alarm word, nor as `active` when it
was retired an hour after its last photo.

The rejected files warning follows the same clocks. A camera is
*rejecting* while its latest rejected file is newer than its latest
accepted live image. A camera without a GPS fix after a battery change
rejects a photo or two and then recovers on its own; counting rejections
would keep warning about it for days, while this clears with the first
good photo. A bulk upload never clears it, a carried-in SD card says
nothing about the camera's GPS today.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

CameraStatus = Literal['active', 'inactive', 'never_reported', 'retired']

CAMERA_SILENCE_DAYS = 7


def camera_status(
    last_report_arrival: Optional[datetime],
    last_image_arrival: Optional[datetime],
    retired_at: Optional[datetime] = None,
) -> CameraStatus:
    """Classify a camera by when it last reached the server.

    `retired` means the camera was taken out of its project, data kept.
    `active` means contact within `CAMERA_SILENCE_DAYS`.
    `inactive` means the camera reached the server before, but not recently.
    `never_reported` means it never reached the server at all.

    The arrival arguments are aware UTC server receive times, or None when
    that kind of contact never happened. Passing a naive datetime raises,
    which is intended: it means a camera-clock column was wired in by
    mistake. `retired_at` is only tested for presence.
    """
    if retired_at is not None:
        return 'retired'
    stamps = [s for s in (last_report_arrival, last_image_arrival) if s is not None]
    if not stamps:
        return 'never_reported'
    cutoff = datetime.now(timezone.utc) - timedelta(days=CAMERA_SILENCE_DAYS)
    return 'active' if max(stamps) >= cutoff else 'inactive'


def is_rejecting(
    last_rejected_at: Optional[datetime],
    last_live_image_at: Optional[datetime],
) -> bool:
    """True while the latest rejected file is newer than the latest live image.

    Both arguments are aware UTC server receive times (`Rejection.rejected_at`,
    `Image.ingested_at` of live images), or None when that never happened. The
    time window is the caller's: it decides which rejections it looked at.
    A naive datetime raises, it means a camera-clock column was wired in.
    """
    for stamp in (last_rejected_at, last_live_image_at):
        if stamp is not None and stamp.tzinfo is None:
            raise ValueError("is_rejecting needs aware UTC server receive times")
    if last_rejected_at is None:
        return False
    return last_live_image_at is None or last_rejected_at > last_live_image_at
